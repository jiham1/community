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

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/post/:id', (req, res) => res.sendFile(__dirname + '/index.html'));

// ── 쿠키 직접 파싱 (cookie-parser 없이) ──
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      list[key] = decodeURIComponent(val);
    });
  }
  return list;
}

// ── 인기글 기준 캐시 (10분마다 갱신) ──
let hotCache = { threshold: 5, avg: 0, stddev: 0, updatedAt: 0 };

async function refreshHotCache() {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await pool.query(`
      SELECT
        COALESCE(AVG(likes - dislikes), 0) AS avg,
        COALESCE(STDDEV_POP(likes - dislikes), 0) AS stddev
      FROM posts
      WHERE is_deleted = FALSE AND created_at >= $1
    `, [weekAgo]);
    const { avg, stddev } = result.rows[0];
    const computed = parseFloat(avg) + parseFloat(stddev) * 1.6;
    const newThreshold = Math.max(5, Math.round(computed * 10) / 10);

    // 기준 충족하는 글 중 became_hot_at 없는 글에만 현재 시각 기록
    await pool.query(`
      UPDATE posts SET became_hot_at = NOW()
      WHERE is_deleted = FALSE AND (likes - dislikes) >= $1 AND became_hot_at IS NULL
    `, [newThreshold]);

    // 기준 미달인데 became_hot_at 있는 글은 초기화
    await pool.query(`
      UPDATE posts SET became_hot_at = NULL
      WHERE (likes - dislikes) < $1 AND became_hot_at IS NOT NULL
    `, [newThreshold]);

    hotCache = {
      threshold: newThreshold,
      avg: Math.round(parseFloat(avg) * 10) / 10,
      stddev: Math.round(parseFloat(stddev) * 10) / 10,
      updatedAt: Date.now()
    };
  } catch (err) {
    console.error('hotCache refresh error:', err);
  }
}

refreshHotCache();
setInterval(refreshHotCache, 10 * 60 * 1000);

async function checkNickname(author, password) {
  const postCheck = await pool.query(
    'SELECT password FROM posts WHERE author = $1 ORDER BY id ASC LIMIT 1', [author]
  );
  if (postCheck.rows.length > 0) return postCheck.rows[0].password === password;
  const commentCheck = await pool.query(
    'SELECT password FROM comments WHERE author = $1 ORDER BY id ASC LIMIT 1', [author]
  );
  if (commentCheck.rows.length > 0) return commentCheck.rows[0].password === password;
  return true;
}

function deleteThreshold(views) {
  return Math.floor(views * (1 / (views + 7) + 1 / 2)) + 1;
}

async function cleanExpiredDeletedPosts() {
  try {
    // deleted_at이 NULL인 삭제글은 현재 시각으로 채움
    await pool.query('UPDATE posts SET deleted_at = NOW() WHERE is_deleted = TRUE AND deleted_at IS NULL');
    const expireDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await pool.query('DELETE FROM posts WHERE is_deleted = TRUE AND deleted_at < $1', [expireDate]);
    const deleted = await pool.query('SELECT id FROM posts WHERE is_deleted = TRUE ORDER BY deleted_at ASC');
    if (deleted.rows.length > 10) {
      const toDelete = deleted.rows.slice(0, deleted.rows.length - 10);
      for (const row of toDelete) {
        await pool.query('DELETE FROM posts WHERE id = $1', [row.id]);
      }
    }
  } catch (err) {
    console.error('cleanup error:', err);
  }
}

setInterval(cleanExpiredDeletedPosts, 60 * 60 * 1000);

// 1. 전체글 (검색 + 정렬 + 기간 + 페이지네이션)
app.get('/api/posts', async (req, res) => {
  const { search = '', sort = 'newest', page = 1, period = 'all' } = req.query;
  const limit = 15;
  const offset = (page - 1) * limit;
  const orderBy = sort === 'views' ? 'posts.views DESC'
                : sort === 'votes' ? '(posts.likes - posts.dislikes) DESC'
                : 'posts.id DESC';
  try {
    const conditions = ['posts.is_deleted = FALSE'];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`posts.title ILIKE $${params.length}`);
    }
    if (period === 'today') {
      params.push(new Date(Date.now() - 24 * 60 * 60 * 1000));
      conditions.push(`posts.created_at >= $${params.length}`);
    } else if (period === 'week') {
      params.push(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      conditions.push(`posts.created_at >= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await pool.query(`
      SELECT posts.*, COUNT(comments.id) AS comment_count
      FROM posts
      LEFT JOIN comments ON comments.post_id = posts.id
      ${where}
      GROUP BY posts.id
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    const countResult = await pool.query(`SELECT COUNT(*) FROM posts ${where}`, params);
    res.json({ posts: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error('GET /api/posts error:', err);
    res.status(500).send(err.message);
  }
});

// 2. 인기글 (캐시 사용)
app.get('/api/posts/hot', async (req, res) => {
  try {
    const { threshold, avg, stddev, updatedAt } = hotCache;
    const result = await pool.query(`
      SELECT posts.*, COUNT(comments.id) AS comment_count
      FROM posts
      LEFT JOIN comments ON comments.post_id = posts.id
      WHERE posts.is_deleted = FALSE AND (posts.likes - posts.dislikes) >= $1
      GROUP BY posts.id
      ORDER BY (posts.likes - posts.dislikes) DESC
    `, [threshold]);
    res.json({ posts: result.rows, threshold, avg, stddev, updatedAt });
  } catch (err) {
    console.error('GET /api/posts/hot error:', err);
    res.status(500).send(err.message);
  }
});

// 3. 삭제글
app.get('/api/posts/deleted', async (req, res) => {
  const { search = '' } = req.query;
  try {
    await cleanExpiredDeletedPosts();
    const where = search
      ? `WHERE posts.is_deleted = TRUE AND posts.title ILIKE $1`
      : `WHERE posts.is_deleted = TRUE`;
    const params = search ? [`%${search}%`] : [];
    const result = await pool.query(`
      SELECT posts.*, COUNT(comments.id) AS comment_count
      FROM posts
      LEFT JOIN comments ON comments.post_id = posts.id
      ${where}
      GROUP BY posts.id
      ORDER BY posts.deleted_at DESC
    `, params);
    const total = await pool.query('SELECT COUNT(*) FROM posts WHERE is_deleted = TRUE');
    res.json({ posts: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error('GET /api/posts/deleted error:', err);
    res.status(500).send(err.message);
  }
});

// 4. 게시글 상세 (쿠키 직접 파싱, 하루 3번)
app.get('/api/get-post/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    const cookies = parseCookies(req);
    const cookieKey = `viewed_${postId}`;
    const today = new Date().toISOString().slice(0, 10);

    let viewCount = 0;
    if (cookies[cookieKey]) {
      try {
        const parsed = JSON.parse(cookies[cookieKey]);
        if (parsed.date === today) viewCount = parsed.count;
      } catch {}
    }

    let setCookieHeader = null;
    if (viewCount < 3) {
      await pool.query('UPDATE posts SET views = views + 1 WHERE id = $1', [postId]);
      const newVal = encodeURIComponent(JSON.stringify({ date: today, count: viewCount + 1 }));
      setCookieHeader = `${cookieKey}=${newVal}; Max-Age=86400; Path=/; HttpOnly`;
    }

    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    if (setCookieHeader) res.setHeader('Set-Cookie', setCookieHeader);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 5. 게시글 작성
app.post('/api/posts', async (req, res) => {
  const { title, content, author, password } = req.body;
  try {
    const ok = await checkNickname(author, password);
    if (!ok) return res.status(403).send("비밀번호 불일치");
    await pool.query(
      'INSERT INTO posts (title, content, author, password) VALUES ($1, $2, $3, $4)',
      [title, content, author || '익명', password]
    );
    io.emit('update');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 6. 추천/비추천
app.post('/api/vote/:id', async (req, res) => {
  const { type } = req.body;
  const col = type === 'up' ? 'likes' : 'dislikes';
  try {
    const result = await pool.query(
      `UPDATE posts SET ${col} = ${col} + 1 WHERE id = $1 RETURNING likes, dislikes`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 7. 삭제 투표
app.post('/api/posts/:id/delete-vote', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE posts SET delete_votes = delete_votes + 1 WHERE id = $1 RETURNING delete_votes, views',
      [req.params.id]
    );
    const { delete_votes, views } = result.rows[0];
    const threshold = deleteThreshold(views);
    if (delete_votes >= threshold) {
      await pool.query(
        'UPDATE posts SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1',
        [req.params.id]
      );
      await cleanExpiredDeletedPosts();
      io.emit('update');
      return res.json({ moved: true });
    }
    res.json({ moved: false, delete_votes, threshold });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 8. ImgBB 업로드
app.post('/api/upload-image', async (req, res) => {
  const { image } = req.body;
  try {
    const formData = new URLSearchParams();
    formData.append('image', image);
    formData.append('key', process.env.IMGBB_API_KEY);
    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (data.success) {
      res.json({ url: data.data.url });
    } else {
      res.status(500).json({ error: 'Upload failed' });
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 9. 댓글 목록
app.get('/api/comments/:postId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM comments WHERE post_id = $1 ORDER BY id ASC',
      [req.params.postId]
    );
    const all = result.rows;
    const map = {};
    const roots = [];
    all.forEach(c => { map[c.id] = { ...c, replies: [] }; });
    all.forEach(c => {
      if (c.parent_id) {
        if (map[c.parent_id]) map[c.parent_id].replies.push(map[c.id]);
      } else {
        roots.push(map[c.id]);
      }
    });
    res.json(roots);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 10. 댓글 작성
app.post('/api/comments', async (req, res) => {
  const { post_id, author, password, content, parent_id } = req.body;
  try {
    const ok = await checkNickname(author, password);
    if (!ok) return res.status(403).send("비밀번호 불일치");
    await pool.query(
      'INSERT INTO comments (post_id, author, content, password, parent_id) VALUES ($1, $2, $3, $4, $5)',
      [post_id, author || '익명', content, password, parent_id || null]
    );
    io.emit('update-comments');
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
