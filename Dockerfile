# Online demo image (Hugging Face Spaces, Docker SDK). The workstation itself runs offline; see README.md.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY pyproject.toml README.md ./
COPY abhedya/ abhedya/
COPY contracts/ contracts/
RUN pip install --no-cache-dir -e .
COPY data/sample.csv data/sample.csv
COPY --from=web /app/web/dist web/dist
# analyse the sample case at build time, so the first visitor gets an instant answer
RUN python -m abhedya ingest --data data/sample.csv && chown -R user:user /app
USER user
ENV ABHEDYA_DEMO=1 PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["python", "-m", "abhedya", "serve", "--data", "data/sample.csv", "--host", "0.0.0.0", "--port", "7860"]
