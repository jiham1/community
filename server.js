const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Neon DB 연결 설정 (환경 변수 사용)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
  console.log('새로운 사용자가 접속했습니다.');

  // 접속 시 기존 게시글 불러오기
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 50');
    socket.emit('load posts', result.rows);
  } catch (err) {
    console.error('DB 불러오기 에러:', err);
  }

  // 새 글 작성 이벤트 처리
  socket.on('new post', async (data) => {
    try {
      const { author, content } = data;
      const insertQuery = 'INSERT INTO posts (author, content) VALUES ($1, $2) RETURNING *';
      const result = await pool.query(insertQuery, [author, content]);
      
      // 모든 사용자에게 새 글 전송
      io.emit('render post', result.rows[0]);
    } catch (err) {
      console.error('DB 저장 에러:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`));
