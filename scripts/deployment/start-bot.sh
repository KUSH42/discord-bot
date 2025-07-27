#!/bin/bash
# Start Xvfb in the background
/usr/bin/Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
# Wait a few seconds for Xvfb to initialize
sleep 2
# Change to the project directory (script is now in scripts/deployment/)
cd "$(dirname "$0")/../.."
# Install dependencies
if command -v npm &> /dev/null; then
    npm install
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    npm install
fi

# Start the Node.js bot using system node or nvm if available
if command -v node &> /dev/null; then
    npm run decrypt
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    npm run decrypt
else
    echo "Node.js not found. Please install Node.js or NVM."
    exit 1
fi
