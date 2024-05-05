const express = require('express')
const app = express()
app.use(express.json())
let database = null
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const authenticationwithToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  }
}

const initializeDBandServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}
initializeDBandServer()

const tweetAccessVerfication = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const getTweetQuery = `
            SELECT
              *
            FROM
            tweet INNER JOIN follower
            ON tweet.user_id=follower.following_user_id
            WHERE tweet.tweet_id=${tweetId} AND follower.follower_user_id=${userId};`
  const tweet = await database.get(getTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectedUserQuery = `
          SELECT
            *
          FROM
            user
          WHERE
            username='${username}';`
  const dbUser = await database.get(selectedUserQuery)
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const createUserQuery = `
          INSERT INTO
            user(username,password,name,gender)
          VALUES(
            '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
          );`
      const dbResponse = await database.run(createUserQuery)
      const userId = dbResponse.lastID
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectedUserQuery = `
              SELECT
                *
              FROM
                user
              WHERE
                username='${username}';`
  const dbUser = await database.get(selectedUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched) {
      const payload = {username: username, userId: dbUser.user_id}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get(
  'user/tweets/feed/',
  authenticationwithToken,
  async (request, response) => {
    const {username, userId} = request
    console.log(userId)
    const getTweetsQuery = `
                    SELECT
                    user.username, tweet.tweet, tweet.date_time AS dateTime
                    FROM
                    follower
                    INNER JOIN tweet
                    ON follower.following_user_id = tweet.user_id
                    INNER JOIN user
                    ON tweet.user_id = user.user_id
                    WHERE
                    follower.follower_user_id = ${userId}
                    ORDER BY
                    tweet.date_time DESC
                    LIMIT 4;`
    const tweetQuery = await database.all(getTweetsQuery)
    response.send(tweetQuery)
  },
)

app.get(
  '/user/following/',
  authenticationwithToken,
  async (request, response) => {
    const {username, userId} = request
    const getUserFollowingQuery = `
                  SELECT
                    name
                  FROM
                    user
                    INNER JOIN follower ON user.user_id=follower.follower_user_id
                    WHERE follower_user_id='${userId}';`
    const userFollowing = await database.all(getUserFollowingQuery)
    response.send(userFollowing)
  },
)

app.get(
  '/user/followers/',
  authenticationwithToken,
  async (request, response) => {
    const {username, userId} = request
    const getFollowerQuery = `
            SELECT DISTINCT name FROM follower
            INNER JOIN user ON user.user_id=follower.follower_user_id
            WHERE following_user_id='${userId}';`
    const follower = await database.all(getFollowerQuery)
    response.send(follower)
  },
)
app.get(
  '/tweets/:tweetId/',
  authenticationwithToken,
  tweetAccessVerfication,
  async (request, response) => {
    const {username, userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `
              SELECT tweet,
              (SELECT COUNT() FROM like WHERE tweet_id=${tweetId}) AS likes,
              (SELECT COUNT() FROM reply WHERE tweet_id=${tweetId}) AS replies,
              date_time AS dateTime
              FROM tweet
              WHERE tweet_id=${tweetId};`
    const tweet = await database.get(getTweetQuery)
    response.send(tweet)
  },
)
app.get(
  '/tweets/:tweetId/likes/',
  authenticationwithToken,
  tweetAccessVerfication,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikeQuery = `
        SELECT username
        FROM user INNER JOIN like ON user.user_id=like.user_id
        WHERE 
        tweet_id=${tweetId};`
    const likeUsers = await database.all(getLikeQuery)
    const userArray = likeUsers.map(eachUser => eachUser.username)
    response.send({likes: userArray})
  },
)
app.get(
  '/tweets/:tweetId/replies/',
  authenticationwithToken,
  tweetAccessVerfication,
  async (request, response) => {
    const {tweetId} = request.params
    const getReplyQuery = `
            SELECT name,reply
            FROM user INNER JOIN reply ON user.user_id=reply.user_id
            WHERE tweet_id=${tweetId};`
    const reply = await database.all(getReplyQuery)
    response.send({replies: reply})
  },
)
app.get('/user/tweets/', authenticationwithToken, async (request, response) => {
  const {userId} = request
  const getTweetQuery = `
              SELECT tweet,
              COUNT(DISTINCT like_id) AS likes,
              COUNT(DISTINCT reply_id) AS replies,
              date_time AS dateTime
              FROM tweet LEFT JOIN reply ON tweet.tweet_id=reply.tweet_id
              LEFT JOIN like ON tweet.tweet_id=like.tweet_id
              WHERE tweet.user_id=${userId}
              GROUP BY tweet.tweet_id;`
  const tweets = await database.all(getTweetQuery)
  response.send(tweets)
})
app.post(
  '/user/tweets/',
  authenticationwithToken,
  async (request, response) => {
    const {tweet} = request.body
    const {userId} = parseInt(request.userId)
    const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
    const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time)
                VALUES('${tweet}',${userId},'${dateTime}');`
    await database.run(createTweetQuery)
    response.send('Created a Tweet')
  },
)
app.delete(
  '/tweets/:tweetId/',
  authenticationwithToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {userId} = request
    const getTweetQuery = `SELECT * FROM tweet WHERE user_id=${userId} AND tweet_id=${tweetId};`
    const tweet = await database.get(getTweetQuery)
    if (tweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id=${tweetId};`
      await database.run(deleteTweetQuery)
      response.send('Tweet Removed')
    }
  },
)
module.exports = app
