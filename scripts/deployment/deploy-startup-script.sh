#!/bin/bash

# Deploy improved startup script to prevent Xvfb timing issues
# This script should be run on the server with appropriate privileges

set -e

echo "🚀 Deploying improved Discord Bot startup script..."

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run as root or with sudo"
    echo "Usage: sudo $0"
    exit 1
fi

# Backup current script
if [ -f "/usr/local/bin/discord-youtube-bot-start.sh" ]; then
    echo "📦 Backing up current startup script..."
    cp /usr/local/bin/discord-youtube-bot-start.sh /usr/local/bin/discord-youtube-bot-start.sh.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup created"
fi

# Deploy new script
if [ -f "/tmp/discord-youtube-bot-start-new.sh" ]; then
    echo "📋 Deploying new startup script..."
    cp /tmp/discord-youtube-bot-start-new.sh /usr/local/bin/discord-youtube-bot-start.sh
    chmod +x /usr/local/bin/discord-youtube-bot-start.sh
    echo "✅ New startup script deployed"
    
    # Clean up temp file
    rm /tmp/discord-youtube-bot-start-new.sh
    echo "🧹 Cleaned up temporary file"
else
    echo "❌ New startup script not found at /tmp/discord-youtube-bot-start-new.sh"
    echo "Please copy the new script to the server first"
    exit 1
fi

echo "🔄 Restarting Discord Bot service..."
systemctl restart discord-youtube-bot.service

echo "⏳ Waiting for service to start..."
sleep 5

echo "📊 Service status:"
systemctl status discord-youtube-bot.service --no-pager -l

echo ""
echo "✅ Deployment complete!"
echo "💡 The improved startup script includes:"
echo "   - Proper Xvfb readiness checking with xdpyinfo"
echo "   - 30-second timeout with progress updates"
echo "   - Better error handling and cleanup"
echo "   - Detailed logging for troubleshooting"