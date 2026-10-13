#!/bin/bash

set -e

PACKAGE_DIR="package"

if ! npm whoami &> /dev/null; then
  echo "Error: Not logged in to npm. Run 'npm login' first."
  exit 1
fi

CURRENT_VERSION=$(node -p "require('./$PACKAGE_DIR/package.json').version")
echo "Current version: $CURRENT_VERSION"
echo ""

read -p "New version, or patch|minor|major (enter keeps $CURRENT_VERSION): " NEW_VERSION

if [ -n "$NEW_VERSION" ]; then
  (cd "$PACKAGE_DIR" && npm version "$NEW_VERSION" --no-git-tag-version)
fi

VERSION=$(node -p "require('./$PACKAGE_DIR/package.json').version")

if npm view "@ape-egg/overlens@$VERSION" version &> /dev/null; then
  echo "Error: @ape-egg/overlens@$VERSION is already on npm. Pick a new version."
  exit 1
fi

echo ""
echo "Publishing @ape-egg/overlens@$VERSION..."
(cd "$PACKAGE_DIR" && npm publish --access public)

echo ""
echo "Done! Published @ape-egg/overlens@$VERSION"
