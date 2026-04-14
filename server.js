app.post('/api/posts', async (req, res) => {
  const { title, content, author } = req.body; // author를 추가로 받음
  try {
    await pool.query(
      // author 컬럼에 값이 없으면 '익명'을 넣도록 설정
      'INSERT INTO posts (title, content, author) VALUES ($1, $2, $3)', 
      [title, content, author || '익명'] 
    );
    io.emit('update');
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});
