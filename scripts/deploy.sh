#!/bin/bash
# Deploy the Regional Power Explorer to hermes (served at ares.internationalmapping.com).
# Same flow as the other apps-wb deploy scripts: build, tar dist, scp it to
# public_html/$HOST_PATH, untar it there.
#
# Usage: pnpm run deploy   (or: bash scripts/deploy.sh — needs bash, not sh/dash)
set -u

print_error() {
  local color_e="\033[30;41m"
  local color_n="\033[0m"
  echo -e "${color_e}ERROR: $*${color_n}"
  exit 1
}

DATE=$(date +"%Y%m%d")
FILENAME="dist_$DATE.tar.gz"
OUTPUT_DIR="dist"
# The site is served from ares.internationalmapping.com, but that name sits
# behind Cloudflare (port 22 is not proxied), so ssh/scp go to the server's
# direct hostname, hermes.
SITE_HOST="ares.internationalmapping.com"
HOST="hermes.internationalmapping.com"
HOST_PORT="22"
HOST_USER="ima5300"
HOST_PRIVATE_KEY="~/.ssh/ima-hermes-key.pem"
HOST_HOME_PATH="/home/intlmaps/domains/ares.internationalmapping.com/public_html"
HOST_PATH="wb-regional-power-explorer"
# Public URL prefix the app is served under. Passed to Vite so hashed assets
# and index.html resolve under the subfolder instead of the domain root.
BASE_PATH="/$HOST_PATH/"
# The assistant's models go through the AI gateway on this Cairn server: users
# sign in with it, and it adds the org's provider credential server-side.
export VITE_CAIRN_SERVER="${VITE_CAIRN_SERVER:-https://wb-sandbox.internationalmapping.com}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR" || print_error "$APP_DIR not found!"

echo "Begin deployment to $HOST!"
echo "output: $FILENAME"
echo "dest: $HOST:$HOST_HOME_PATH/$HOST_PATH  (https://$SITE_HOST$BASE_PATH)"

echo "Building with base $BASE_PATH"
npx vite build --base="$BASE_PATH" || print_error "Build failed"

# Apache SPA fallback: react-router uses real URLs (/region/x, /country/x),
# so any path under the subfolder that isn't a real file must serve index.html.
cat > "$OUTPUT_DIR/.htaccess" <<HTACCESS
RewriteEngine On
RewriteBase $BASE_PATH
RewriteRule ^index\.html\$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . index.html [L]
HTACCESS

echo "Creating tar.gz of ./$OUTPUT_DIR"
cd "$OUTPUT_DIR" || print_error "$OUTPUT_DIR not found!"
rm -f dist_*.tar.gz
# Include dotfiles (.htaccess) alongside everything else.
tar -zcvf "$FILENAME" --exclude="$FILENAME" -- .htaccess * || print_error "Failed to tar $OUTPUT_DIR"

# Upload. Uses the private key when HOST_PRIVATE_KEY is set, else password auth.
ssh -p"$HOST_PORT" ${HOST_PRIVATE_KEY:+-i "$HOST_PRIVATE_KEY"} "$HOST_USER@$HOST" "mkdir -p '$HOST_HOME_PATH/$HOST_PATH'" \
  || print_error "Could not create $HOST_HOME_PATH/$HOST_PATH on $HOST"

error=$(scp -v -P"$HOST_PORT" ${HOST_PRIVATE_KEY:+-i "$HOST_PRIVATE_KEY"} "$FILENAME" "$HOST_USER@$HOST:$HOST_HOME_PATH/$HOST_PATH" 2>&1)
exit_status=$?
if [ $exit_status -ne 0 ]; then
  print_error "$error"
fi

ssh -p"$HOST_PORT" ${HOST_PRIVATE_KEY:+-i "$HOST_PRIVATE_KEY"} "$HOST_USER@$HOST" <<ENDSSH
echo "Opening directory $HOST_PATH";
cd "$HOST_HOME_PATH/$HOST_PATH" || exit 1;
echo "Removing previous build assets.";
rm -rf assets;
echo "Untaring new build.";
tar xzvf "$HOST_HOME_PATH/$HOST_PATH/$FILENAME" || { echo "ERROR: Failed to untar $FILENAME"; exit 1; };
# The tarball is left in place as a record of what was deployed (same as the
# other apps-wb scripts). Uncomment to clean up:
#echo "Removing $FILENAME";
#rm -f "$HOST_HOME_PATH/$HOST_PATH/$FILENAME";
echo "Complete.";
exit;
ENDSSH

echo "Deployment to $HOST complete!"
echo "https://$SITE_HOST$BASE_PATH"
