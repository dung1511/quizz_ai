# QuizAI

QuizAI giúp biến tài liệu học tập thành bài kiểm tra trắc nghiệm có đáp án, giải thích và nguồn tham khảo. Người dùng có thể làm bài, xem lịch sử điểm và ôn tập lại những câu đã trả lời sai.

[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)](https://vite.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL%2FMariaDB-database-4479a1?logo=mysql&logoColor=white)](https://www.mysql.com/)

**Mã nguồn:** [github.com/dung1511/quizz_ai](https://github.com/dung1511/quizz_ai)  
**Chạy thử cục bộ:** `http://localhost:3000`  
Hiện chưa có đường dẫn demo trực tuyến được cấu hình trong repository.

## Mục lục

- [Tính năng](#tính-năng)
- [Công nghệ](#công-nghệ)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Yêu cầu](#yêu-cầu)
- [Cài đặt và chạy cục bộ](#cài-đặt-và-chạy-cục-bộ)
- [Hướng dẫn sử dụng](#hướng-dẫn-sử-dụng)
- [Cấu hình môi trường](#cấu-hình-môi-trường)
- [Kiểm tra dự án](#kiểm-tra-dự-án)
- [Triển khai](#triển-khai)
- [Xử lý sự cố](#xử-lý-sự-cố)

## Tính năng

- **Tạo đề từ tài liệu:** tải lên PDF, DOCX hoặc TXT; hoặc nhập nội dung theo chủ đề.
- **Tạo câu hỏi có nguồn:** câu hỏi có thể kèm chương, mục, trang và đoạn văn bản làm căn cứ. Có chế độ chỉ chấp nhận câu hỏi ghép được với nội dung tài liệu.
- **Tùy chỉnh đề:** chọn số câu, độ khó, chương và ma trận câu hỏi.
- **Làm bài trực tuyến:** chọn đáp án, chuyển qua lại giữa các câu, đánh dấu câu cần xem lại và nộp bài.
- **Xem kết quả:** điểm số, số câu đúng/sai, phân tích theo chủ đề và độ khó, đáp án cùng lời giải.
- **Ôn tập câu sai:** mỗi lượt thi có phần ôn tập riêng, chỉ gồm các câu đã trả lời sai trong lượt đó. Nội dung câu hỏi, phương án, đáp án đúng và lời giải được giữ nguyên; tính năng không dùng AI để sinh lại câu hỏi.
- **Kho tài liệu và lịch sử:** quản lý tài liệu, bộ đề, lượt thi và các lần ôn tập.
- **Tài khoản người dùng:** đăng ký và đăng nhập bằng email, mật khẩu. Lịch sử thi và ôn tập được lưu riêng theo tài khoản trong MySQL.
- **Xuất đề:** hỗ trợ xuất đề và tài liệu theo các định dạng được cung cấp trong giao diện.
- **Hiển thị công thức và hình:** hỗ trợ công thức toán bằng KaTeX và một số hình minh họa TikZ.

> **Lưu ý về tài liệu scan:** bộ trích xuất hiện đọc văn bản từ PDF, DOCX và TXT; không tích hợp OCR. PDF scan dưới dạng ảnh cần được OCR trước khi tải lên để hệ thống có thể đọc nội dung.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Giao diện | React 19, TypeScript, Vite 6 |
| Kiểu dáng | Tailwind CSS 4 |
| Máy chủ và API | Node.js, Express 4 |
| Cơ sở dữ liệu | MySQL hoặc MariaDB, qua `mysql2` |
| AI | Google Gemini API |
| Đọc tài liệu | `pdf-parse`, `mammoth` |
| Xuất tài liệu | `docx` |

## Cấu trúc dự án

```text
.
├── public/                 # Tài nguyên tĩnh
├── server.ts               # Express API và máy chủ Vite/production
├── server/
│   ├── schema.sql          # Cấu trúc bảng MySQL
│   ├── storage.ts          # Kết nối MySQL và thao tác lưu trữ
│   ├── auth.ts             # Băm mật khẩu và quản lý session token
│   ├── quizAttempts.ts     # Chấm điểm và xây dựng bộ câu hỏi ôn tập
│   ├── documentExtractor.ts
│   ├── documentProcessor.ts
│   ├── questionGenerator.ts
│   └── aiText/             # Luồng tạo nội dung/câu hỏi theo chủ đề
└── src/
    ├── App.tsx             # Điều hướng màn hình và trạng thái ứng dụng
    ├── types.ts            # Kiểu dữ liệu dùng chung
    ├── components/         # Màn hình và thành phần giao diện
    ├── services/api.ts     # Gọi API backend
    ├── data/sampleData.ts  # Dữ liệu minh họa trong giao diện
    └── utils/              # Hàm dùng chung cho giao diện
```

## Yêu cầu

- Node.js và npm (khuyến nghị Node.js 20 trở lên).
- MySQL hoặc MariaDB đang chạy. Cấu hình mặc định tương thích với MySQL của XAMPP trên máy cá nhân.
- Khóa Gemini API để dùng các luồng tạo nội dung bằng AI. Một số luồng tạo đề từ tài liệu có chế độ dự phòng, nhưng các chức năng AI cần khóa hợp lệ.

Khi máy chủ khởi động, ứng dụng tạo database (nếu tài khoản MySQL được cấp quyền) và các bảng cần thiết. Không cần chạy migration thủ công.

## Cài đặt và chạy cục bộ

### 1. Tải mã nguồn

```bash
git clone https://github.com/dung1511/quizz_ai.git
cd quizz_ai
```

### 2. Cài dependencies

```bash
npm ci
```

Nếu `npm ci` không dùng được với môi trường của bạn, chạy `npm install`.

### 3. Tạo file môi trường

Trên Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Trên macOS/Linux:

```bash
cp .env.example .env
```

Mở `.env`, điền thông tin MySQL và khóa Gemini nếu sử dụng AI. Ví dụ:

```dotenv
GEMINI_API_KEY=your_gemini_api_key

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=quizz_ai
MYSQL_USER=root
MYSQL_PASSWORD=
```

Tạo khóa Gemini tại [Google AI Studio](https://aistudio.google.com/app/apikey).

Trong XAMPP, khởi động dịch vụ **MySQL**. Nếu tài khoản MySQL có mật khẩu, điền mật khẩu vào `MYSQL_PASSWORD`. Tài khoản cần quyền tạo database và bảng khi chạy lần đầu.

### 4. Khởi động ứng dụng

```bash
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000). Backend Express và giao diện Vite được phục vụ cùng một địa chỉ; không cần chạy thêm một lệnh dev server riêng.

Khi sửa cấu hình hoặc cập nhật mã backend, dừng tiến trình hiện tại bằng `Ctrl+C`, sau đó chạy lại `npm run dev`.

## Hướng dẫn sử dụng

### Tạo tài khoản và đăng nhập

1. Mở ứng dụng tại `http://localhost:3000`.
2. Chọn **Đăng ký**, nhập email và mật khẩu (tối thiểu 8 ký tự).
3. Sau khi đăng ký, ứng dụng tự đăng nhập và mở không gian làm việc.

### Tạo đề từ tài liệu

1. Chọn PDF, DOCX hoặc TXT, hoặc chuyển sang mục nhập nội dung theo chủ đề.
2. Chọn số câu, độ khó, phạm vi tài liệu và chế độ kiểm định nguồn.
3. Bắt đầu tạo đề, xem bộ câu hỏi rồi chọn **Làm bài**.
4. Khi nộp bài, kết quả và bộ câu hỏi của lượt thi được lưu vào tài khoản.

Nếu bật chế độ **Chống bịa đặt (Chỉ sinh từ nguồn tài liệu gốc)**, hệ thống chỉ chấp nhận các câu có thể đối chiếu với đoạn văn bản trích xuất. Tài liệu ngắn, scan chưa OCR hoặc trích dẫn không khớp có thể khiến quá trình tạo đề bị từ chối.

### Ôn tập câu đã trả lời sai

1. Mở **Kho tài liệu** → tab **Lịch sử điểm**.
2. Tìm lượt thi cần ôn và chọn **Bắt đầu ôn tập**.
3. Trả lời các câu sai từ lượt thi đó, chuyển câu và nộp bài như một bài kiểm tra thông thường.
4. Xem điểm, câu trả lời, đáp án đúng và lời giải; có thể chọn **Ôn tập lại** hoặc quay về lịch sử điểm.

Mỗi lần ôn được lưu thành một lượt riêng và gắn với lượt thi gốc. Lượt thi gốc không bị thay đổi. Câu chưa trả lời không được xem là câu đã trả lời sai để đưa vào bộ ôn tập.

## Cấu hình môi trường

| Biến | Bắt buộc | Mô tả |
|---|---:|---|
| `MYSQL_HOST` | Không | Máy chủ MySQL. Mặc định `127.0.0.1`. |
| `MYSQL_PORT` | Không | Cổng MySQL. Mặc định `3306`. |
| `MYSQL_DATABASE` | Không | Database của ứng dụng. Mặc định `quizz_ai`. |
| `MYSQL_USER` | Không | Tài khoản MySQL. Mặc định `root`. |
| `MYSQL_PASSWORD` | Không | Mật khẩu MySQL. Mặc định để trống. |
| `GEMINI_API_KEY` | Tùy chức năng | Khóa Gemini dùng cho các chức năng AI. |
| `GEMINI_API_KEY1` | Không | Khóa dự phòng nếu `GEMINI_API_KEY` không được đặt. |
| `XELATEX_PATH` | Không | Đường dẫn tới `xelatex` nếu cần cấu hình riêng cho dựng hình TikZ. |
| `PDFTOCAIRO_PATH` | Không | Đường dẫn tới `pdftocairo` nếu cần cấu hình riêng cho dựng hình TikZ. |

`.env` đã được loại khỏi Git. Không đưa khóa Gemini, mật khẩu database hoặc dữ liệu tài khoản lên repository công khai.

## Kiểm tra dự án

```bash
# Kiểm tra TypeScript
npm run lint

# Chạy các bài kiểm thử
node --import tsx --test server/auth.test.ts server/quizAttempts.test.ts server/sourceQuality.test.ts server/mathRendering.test.ts

# Build giao diện và máy chủ
npm run build
```

## Triển khai

Build ứng dụng:

```bash
npm run build
```

Sau đó cấu hình các biến môi trường cho máy chủ triển khai và chạy:

```bash
npm start
```

Đặt `NODE_ENV=production` để Express phục vụ frontend đã build trong `dist/` và bật thuộc tính `Secure` cho cookie session. Trên Windows PowerShell:

```powershell
$env:NODE_ENV = "production"
npm start
```

Trên macOS/Linux:

```bash
NODE_ENV=production npm start
```

Máy chủ lắng nghe cổng `3000`. Cấu hình reverse proxy/domain/HTTPS ở nền tảng triển khai; production cần HTTPS để cookie session hoạt động an toàn.

`npm run preview` chỉ chạy Vite preview; để kiểm tra đầy đủ API và database, dùng `npm run dev` hoặc build rồi chạy `npm start`.

## Xử lý sự cố

### Không kết nối được MySQL

- Kiểm tra dịch vụ MySQL/MariaDB đang chạy.
- Kiểm tra `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER` và `MYSQL_PASSWORD`.
- Xác nhận tài khoản có quyền tạo database và bảng.
- Đọc lỗi khởi động trong terminal chạy `npm run dev`; máy chủ sẽ báo lỗi nếu không khởi tạo được storage.

### Trình duyệt báo lỗi địa chỉ hoặc không mở được trang

Dùng `http://localhost:3000`, không dùng `http://0.0.0.0:3000` làm địa chỉ mở trong trình duyệt. `0.0.0.0` là địa chỉ bind máy chủ, không phải địa chỉ truy cập thông thường.

### Không dùng được chức năng AI

- Kiểm tra `GEMINI_API_KEY` trong `.env`, không để nguyên giá trị mẫu `MY_GEMINI_API_KEY`.
- Khởi động lại máy chủ sau khi thay đổi `.env`.
- Kiểm tra khóa có quyền sử dụng model và dịch vụ Gemini không đang giới hạn lưu lượng.

### Tạo đề báo không đối chiếu được nguồn

Kiểm tra văn bản trích xuất trong tài liệu. Với PDF scan, chạy OCR trước rồi tải bản có lớp văn bản lên. Nếu chấp nhận câu hỏi không có trích dẫn đối chiếu được, tắt chế độ chỉ tạo câu hỏi có nguồn trong màn hình cấu hình.

### Vừa cập nhật backend nhưng giao diện/API chưa đổi

Dừng máy chủ đang chạy bằng `Ctrl+C`, sau đó chạy lại `npm run dev`. Các bảng mới trong schema được tạo khi máy chủ khởi động.
