#!/bin/bash

set -e

echo "Starting desktop development environment..."

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Please install Node.js first."
  exit 1
fi

echo "Installing root dependencies..."
npm install

echo "Installing front_end dependencies..."
(cd front_end && npm install)

echo "Launching Electron + renderer dev servers..."
npm run desktop:dev
