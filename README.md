# community
# -- 1. 혹시 모르니 기존 테이블을 확실하게 삭제합니다.
# DROP TABLE IF EXISTS posts;

# -- 2. 디시 스타일 필드가 모두 포함된 새 테이블을 만듭니다.
# -- password 뒤에 NOT NULL을 뺐기 때문에, 비번을 안 써도 에러가 안 납니다.
# CREATE TABLE posts (
#  id SERIAL PRIMARY KEY,
#  author TEXT NOT NULL,
#  password TEXT, 
#  title TEXT NOT NULL,
#  content TEXT NOT NULL,
#  views INTEGER DEFAULT 0,
#  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
# );

# -- 3. 테이블이 잘 만들어졌는지 확인용 (결과창에 컬럼 이름들이 뜨면 성공)
# SELECT * FROM posts;
