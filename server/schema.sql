CREATE TABLE IF NOT EXISTS quizai_requests (
  id VARCHAR(191) NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_knowledge_packages (
  id VARCHAR(191) NOT NULL,
  request_id VARCHAR(191) NOT NULL,
  payload LONGTEXT NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quizai_knowledge_request (request_id),
  CONSTRAINT fk_quizai_knowledge_request
    FOREIGN KEY (request_id) REFERENCES quizai_requests (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_web_sources (
  package_id VARCHAR(191) NOT NULL,
  source_id VARCHAR(191) NOT NULL,
  payload LONGTEXT NOT NULL,
  PRIMARY KEY (package_id, source_id),
  CONSTRAINT fk_quizai_source_package
    FOREIGN KEY (package_id) REFERENCES quizai_knowledge_packages (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_quizzes (
  id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NULL,
  knowledge_package_id VARCHAR(191) NULL,
  created_at VARCHAR(40) NOT NULL,
  payload LONGTEXT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quizai_quiz_created (created_at),
  KEY idx_quizai_quiz_user_created (user_id, created_at),
  CONSTRAINT fk_quizai_quiz_knowledge
    FOREIGN KEY (knowledge_package_id) REFERENCES quizai_knowledge_packages (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_storage_metadata (
  metadata_key VARCHAR(191) NOT NULL,
  metadata_value TEXT NOT NULL,
  PRIMARY KEY (metadata_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_users (
  id VARCHAR(191) NOT NULL,
  email VARCHAR(191) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quizai_user_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_sessions (
  token_hash CHAR(64) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_quizai_session_user (user_id),
  KEY idx_quizai_session_expiry (expires_at),
  CONSTRAINT fk_quizai_session_user
    FOREIGN KEY (user_id) REFERENCES quizai_users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_attempts (
  id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  quiz_id VARCHAR(191) NOT NULL,
  attempt_type VARCHAR(16) NOT NULL,
  source_attempt_id VARCHAR(191) NULL,
  attempt_payload LONGTEXT NOT NULL,
  quiz_payload LONGTEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quizai_attempt_user_created (user_id, created_at),
  KEY idx_quizai_attempt_source (user_id, source_attempt_id),
  CONSTRAINT fk_quizai_attempt_user
    FOREIGN KEY (user_id) REFERENCES quizai_users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
