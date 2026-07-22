#!/usr/bin/env bash
# One-shot setup + deploy for the ICE Apple Wallet Cloud Function.
# Reuses the existing `ahl-wallet` GCP project. Idempotent — safe to re-run.
#
# PREREQ (interactive, run these yourself first):
#   gcloud auth login
#   gcloud config set project ahl-wallet
#
# Then:  bash deploy-setup.sh
#
# Secret material is read from the scratchpad by default (this session);
# override with env vars if you moved them:
#   P12=/path/ice_pass_signing.p12  P12PW=/path/ice_p12_password.txt \
#   HMAC=/path/ice_apple_hmac.txt   bash deploy-setup.sh
set -euo pipefail

PROJECT=ahl-wallet
REGION=asia-southeast1
FN=iceApplePass
SCRATCH="/private/tmp/claude-501/-Users-sankha-Projects-ICE-icehub/2e8447ff-45c8-4e0d-b62b-02f414989467/scratchpad"
P12="${P12:-$SCRATCH/ice_pass_signing.p12}"
P12PW="${P12PW:-$SCRATCH/ice_p12_password.txt}"
HMAC="${HMAC:-$SCRATCH/ice_apple_hmac.txt}"

echo "▶ project: $PROJECT   region: $REGION"
gcloud config set project "$PROJECT" >/dev/null

echo "▶ enabling APIs…"
gcloud services enable \
  cloudfunctions.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com run.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com \
  cloudscheduler.googleapis.com >/dev/null

# --- secrets: create if missing, else add a new version ---
put_secret() {  # name  data-file
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    gcloud secrets versions add "$1" --data-file="$2" >/dev/null
    echo "  ↻ $1 (new version)"
  else
    gcloud secrets create "$1" --data-file="$2" >/dev/null
    echo "  ＋ $1 (created)"
  fi
}
echo "▶ uploading secrets…"
TMP_P12_B64="$(mktemp)"; base64 -i "$P12" > "$TMP_P12_B64"
put_secret ice-pass-p12 "$TMP_P12_B64"
put_secret ice-pass-p12-password "$P12PW"
put_secret ice-apple-hmac "$HMAC"
rm -f "$TMP_P12_B64"

echo "▶ granting runtime SA access to the secrets…"
PNUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="${PNUM}-compute@developer.gserviceaccount.com"
for s in ice-pass-p12 ice-pass-p12-password ice-apple-hmac; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1 || true
done

echo "▶ ensuring Firestore (native) database exists…"
gcloud firestore databases create --location="$REGION" --type=firestore-native >/dev/null 2>&1 \
  && echo "  ＋ Firestore created" || echo "  ✓ Firestore already present"

echo "▶ deploying function (this builds in the cloud, ~2 min)…"
npm run deploy

URL="$(gcloud functions describe "$FN" --region="$REGION" --gen2 --format='value(serviceConfig.uri)')"
echo
echo "════════════════════════════════════════════════════════════"
echo "✅ Function URL: $URL"
echo "   HMAC secret (also set as WALLET_APPLE_HMAC in the api Script Properties):"
echo "   $(tr -d '\n' < "$HMAC")"
echo "════════════════════════════════════════════════════════════"

echo "▶ creating Cloud Scheduler job (5-min live refresh)…"
if gcloud scheduler jobs describe ice-apple-refresh --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http ice-apple-refresh --location="$REGION" \
    --schedule="*/5 * * * *" --uri="${URL}/internal/refresh" --http-method=POST \
    --update-headers="X-Refresh-Key=$(tr -d '\n' < "$HMAC")" >/dev/null
  echo "  ↻ scheduler updated"
else
  gcloud scheduler jobs create http ice-apple-refresh --location="$REGION" \
    --schedule="*/5 * * * *" --uri="${URL}/internal/refresh" --http-method=POST \
    --headers="X-Refresh-Key=$(tr -d '\n' < "$HMAC")" >/dev/null
  echo "  ＋ scheduler created"
fi

echo
echo "NEXT — set two Script Properties on the ICE api project, then redeploy the api:"
echo "  WALLET_APPLE_HMAC = (the HMAC value printed above)"
echo "  APPLE_PASS_FN_URL = $URL"
