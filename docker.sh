docker build -t t2bot/matrix-voyager-bot:web-latest -f Dockerfile.web .
docker build -t t2bot/matrix-voyager-bot:bot-latest -f Dockerfile.bot .

echo '## docker push t2bot/matrix-voyager-bot:web-latest && docker push t2bot/matrix-voyager-bot:bot-latest'
