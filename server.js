const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

app.get('/api/posts', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
  res.json(result.rows);
});

app.get('/api/get-post/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
  res.json(result.rows[0]);
});

app.post('/api/posts', async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO posts (title, content) VALUES ($1, $2)', [title, content]);
  io.emit('update');
  res.sendStatus(200);
});

app.get('/api/comments/:postId', async (req, res) => {
  const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC', [req.params.postId]);
  res.json(result.rows);
});

app.post('/api/comments', async (req, res) => {
  const { post_id, author, content, password } = req.body;
  try {
    const check = await pool.query('SELECT password FROM comments WHERE author = $1 ORDER BY id DESC LIMIT 1', [author]);
    if (check.rows.length > 0 && check.rows[0].password && check.rows[0].password !== password) {
      return res.status(403).send("비밀번호 불일치");
    }
    await pool.query('INSERT INTO comments (post_id, author, content, password) VALUES ($1, $2, $3, $4)', [post_id, author, content, password]);
    io.emit('update-comments');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
