#!/bin/bash

# Discord Bot Startup Script with Improved Xvfb Readiness Check
# This script ensures Xvfb is fully ready before starting the Node.js application

set -e  # Exit on error

# Configuration
DISPLAY_NUM=99
DISPLAY=":${DISPLAY_NUM}"
MAX_WAIT_TIME=30  # Maximum seconds to wait for Xvfb
WAIT_INTERVAL=1   # Check interval in seconds

echo "Starting Discord YouTube Bot with enhanced Xvfb readiness check..."

# Function to check if Xvfb is ready
check_xvfb_ready() {
    # Check if Xvfb process is running and display is accessible
    if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
        return 0  # Ready
    else
        return 1  # Not ready
    fi
}

# Function to cleanup on exit
cleanup() {
    echo "Cleaning up..."
    # Kill Xvfb if we started it
    if [ ! -z "$XVFB_PID" ]; then
        echo "Stopping Xvfb (PID: $XVFB_PID)..."
        kill $XVFB_PID 2>/dev/null || true
        wait $XVFB_PID 2>/dev/null || true
    fi
}

# Set up cleanup on script exit
trap cleanup EXIT

# Start Xvfb in the background
echo "Starting Xvfb on display $DISPLAY..."
/usr/bin/Xvfb "$DISPLAY" -screen 0 1280x720x24 -nolisten tcp &
XVFB_PID=$!

# Wait for Xvfb to be ready with proper timeout
echo "Waiting for Xvfb to be ready (max ${MAX_WAIT_TIME}s)..."
wait_time=0
while [ $wait_time -lt $MAX_WAIT_TIME ]; do
    if check_xvfb_ready; then
        echo "✅ Xvfb is ready on display $DISPLAY (took ${wait_time}s)"
        break
    fi
    
    # Check if Xvfb process is still running
    if ! kill -0 $XVFB_PID 2>/dev/null; then
        echo "❌ Xvfb process died unexpectedly!"
        exit 1
    fi
    
    sleep $WAIT_INTERVAL
    wait_time=$((wait_time + WAIT_INTERVAL))
    
    if [ $((wait_time % 5)) -eq 0 ]; then
        echo "⏳ Still waiting for Xvfb... (${wait_time}s elapsed)"
    fi
done

# Check if we timed out
if [ $wait_time -ge $MAX_WAIT_TIME ]; then
    echo "❌ Timeout waiting for Xvfb to be ready after ${MAX_WAIT_TIME}s"
    exit 1
fi

# Export DISPLAY environment variable for child processes
export DISPLAY

echo "🔧 Changing to project directory..."
cd /home/xush/discord-youtube-bot

echo "📦 Installing/updating dependencies..."
/home/xush/.nvm/versions/node/v22.17.0/bin/npm install

echo "🚀 Starting Discord YouTube Bot..."
echo "Using Node.js: $(/home/xush/.nvm/versions/node/v22.17.0/bin/node --version)"
echo "Using Display: $DISPLAY"

# Start the Node.js bot (this will run in foreground)
exec /home/xush/.nvm/versions/node/v22.17.0/bin/node index.js