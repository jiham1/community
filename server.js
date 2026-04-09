const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 1. DB 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static(__dirname));
app.use(express.json());

// 2. 페이지 라우팅
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/post/:id', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// 3. API: 게시글 목록 불러오기
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, author, title, likes, created_at FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

// 4. API: 상세 게시글 불러오기
app.get('/api/get-post/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error");
  }
});

// 5. API: 글 저장 (닉네임 사칭 방지 로직 포함)
app.post('/api/posts', async (req, res) => {
  try {
    const { author, password, title, content } = req.body;
    const userHandle = author || '익명';

    // [사칭 방지 체크] 해당 닉네임으로 작성된 기존 글이 있는지 확인
    const userCheck = await pool.query(
      'SELECT password FROM posts WHERE author = $1 ORDER BY id DESC LIMIT 1',
      [userHandle]
    );

    // 기존 닉네임이 존재할 경우 비밀번호 대조
    if (userCheck.rows.length > 0) {
      if (userCheck.rows[0].password !== password) {
        // 비밀번호가 틀리면 403(Forbidden) 에러와 메시지 전송
        return res.status(403).send("이미 존재하는 닉네임입니다. 비밀번호가 일치하지 않습니다.");
      }
    }

    // [글 저장]
    await pool.query(
      'INSERT INTO posts (author, password, title, content) VALUES ($1, $2, $3, $4)',
      [userHandle, password, title, content]
    );

    io.emit('update'); // 실시간 목록 업데이트 신호
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send("데이터베이스 오류가 발생했습니다.");
  }
});

// 6. API: 추천/비추천
app.post('/api/vote/:id', async (req, res) => {
  try {
    const { type } = req.body;
    const column = type === 'up' ? 'likes' : 'dislikes';
    const result = await pool.query(
      `UPDATE posts SET ${column} = ${column} + 1 WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
