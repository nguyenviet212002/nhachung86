# Ruling C13: khung tam thoi chi de "docker compose up -d" dung duoc ca stack.
# Chua co logic sao luu that o day - Task 18 se thay toan bo ruot cua container nay
# (script pg_dump, luu tru S3, dcron lich chay, xoa ban sao luu cu, v.v.)
FROM alpine:3.20

RUN apk add --no-cache postgresql16-client dcron

# Chi ngu, khong lam gi ca - cho Task 18 dien logic sao luu that vao
ENTRYPOINT ["tail", "-f", "/dev/null"]
