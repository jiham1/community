const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);

// [중요] 모든 도메인에서 접속 가능하도록 CORS 설정
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Neon DB 연결
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static(__dirname));
app.use(express.json());

// 메인 페이지 전달
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 글쓰기 API (POST 방식)
app.post('/api/posts', async (req, res) => {
  try {
    const { author, password, title, content } = req.body;
    const insertQuery = `
      INSERT INTO posts (author, password, title, content) 
      VALUES ($1, $2, $3, $4) RETURNING *
    `;
    const result = await pool.query(insertQuery, [author, password, title, content]);
    
    // 실시간으로 모든 유저에게 새 글 알림
    io.emit('new post notification', result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('서버 오류 발생');
  }
});

// 소켓 통신 로직
io.on('connection', async (socket) => {
  console.log('유저 접속됨');

  // 접속 시 최신글 30개 불러오기
  try {
    const result = await pool.query('SELECT id, author, title, created_at FROM posts ORDER BY created_at DESC LIMIT 30');
    socket.emit('load posts', result.rows);
  } catch (err) {
    console.error('DB 로드 에러:', err);
  }
});

// Not Found 방지: 어떤 주소로 들어와도 index.html 전송
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// ... 앞부분(express, pool 설정 등) 동일 ...

// [추가] 댓글 목록 가져오기 API
app.get('/api/comments/:postId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at ASC', [req.params.postId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send('댓글 로드 실패');
    }
});

// [추가] 댓글 쓰기 API
app.post('/api/comments', async (req, res) => {
    try {
        const { post_id, author, content } = req.body;
        const result = await pool.query(
            'INSERT INTO comments (post_id, author, content) VALUES ($1, $2, $3) RETURNING *',
            [post_id, author, content]
        );
        io.emit('new comment', result.rows[0]); // 실시간 댓글 알림
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).send('댓글 저장 실패');
    }
});

// ... 뒷부분(listen 등) 동일 ...
