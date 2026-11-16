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
  knowledge_package_id VARCHAR(191) NULL,
  created_at VARCHAR(40) NOT NULL,
  payload LONGTEXT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quizai_quiz_created (created_at),
  CONSTRAINT fk_quizai_quiz_knowledge
    FOREIGN KEY (knowledge_package_id) REFERENCES quizai_knowledge_packages (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizai_storage_metadata (
  metadata_key VARCHAR(191) NOT NULL,
  metadata_value TEXT NOT NULL,
  PRIMARY KEY (metadata_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
