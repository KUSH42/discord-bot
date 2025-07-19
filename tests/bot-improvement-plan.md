# Discord Bot Improvement Plan

## Introduction

This document outlines a comprehensive plan to enhance the quality, reliability, and feature set of the Discord-YouTube Bot. It is based on an analysis of the existing codebase and workflows. The plan is divided into three key areas:
1.  **Quality Assurance & End-to-End (E2E) Testing:** Establishing a robust testing suite to ensure application stability and prevent regressions.
2.  **Notification System Enhancement:** Implementing a more reliable and near-instantaneous notification system for new content.
3.  **Discord Rate Limit Handling:** Fortifying the bot's communication with Discord to prevent rate-limiting, especially for high-volume log messages.

---

## Part 1: Quality Assurance & End-to-End (E2E) Testing

### Objective
To implement a suite of automated end-to-end tests that simulate real-world user interactions and system flows. This will ensure that the core functionality works as expected, catch bugs before they reach production, and allow for confident refactoring and development.

### Proposed E2E Test Scenarios

The following scenarios should be developed using the existing Jest testing framework.

#### 1. Core Workflow: YouTube Content Monitoring & Discord Announcement
*   **Description:** This is the primary workflow of the bot. The test will validate the entire pipeline from content detection to announcement.
*   **Steps:**
    1.  **Setup:** Configure the bot to monitor a specific test YouTube channel and post to a dedicated test Discord channel. Ensure the `ANNOUNCEMENT_ENABLED` config is `true`.
    2.  **Action:** Simulate a new video being published on the YouTube channel (this can be mocked or performed on a real test channel).
    3.  **Verification:**
        *   Assert that the `youtube-api-service` (or scraper) correctly identifies the new video.
        *   Assert that the `duplicate-detector` does not flag the new video as a duplicate.
        *   Assert that the `content-announcer` formats the message correctly.
        *   Assert that a message with the correct video title, link, and description is posted to the designated Discord channel.
        *   Assert that if the same video is processed again, it is flagged as a duplicate and **not** announced a second time.

#### 2. Command Processing Workflows
*   **Description:** Test all administrative and user-facing commands to ensure they function correctly and handle arguments properly.
*   **Scenarios:**
    *   **`!health` & `!health-detailed` (`!hd`):**
        *   Send the command and verify that the bot replies with an embed containing the expected health and statistics fields.
    *   **`!announce <true|false>`:**
        *   Send `!announce true`, verify the confirmation message, and check that the `announcementEnabled` state in `stateManager` is updated to `true`.
        *   Send `!announce false`, verify the confirmation message, and check that the state is updated to `false`.
    *   **`!vxtwitter <true|false>`:**
        *   Send `!vxtwitter true`, verify the confirmation message, and check that the `vxTwitterConversionEnabled` state is updated to `true`.
        *   Send `!vxtwitter false`, verify the confirmation message, and check that the state is updated to `false`.
    *   **`!loglevel <level>`:**
        *   Send `!loglevel debug`, verify the confirmation message, and check that the `logLevel` state is updated and the logger's level is changed.
    *   **`!update` (Authorization Required):**
        *   As a non-authorized user, send the command and verify the "not authorized" response.
        *   As an authorized user, send the command and verify that the `git pull` and `systemctl restart` commands are triggered (these can be mocked at the `exec` level).
    *   **`!readme`:**
        *   Send the command and verify the bot replies with the list of commands.
    *   **Invalid Command:**
        *   Send an unknown command (e.g., `!foo`) and verify the bot responds with the "Unknown command" message.

#### 3. Fallback and Recovery
*   **Description:** Test the system's resilience when primary services fail.
*   **Scenario:**
    1.  **Setup:** Configure the bot to monitor a YouTube channel.
    2.  **Action:** Mock the primary YouTube API to return an error or timeout.
    3.  **Verification:**
        *   Assert that the system detects the failure.
        *   Assert that the fallback mechanism (e.g., web scraping) is triggered.
        *   Assert that content is still successfully announced in Discord.

### Testing Environment Setup

#### Creating a Test YouTube Account
A dedicated Google Account should be used for testing to avoid impacting personal accounts and to have a controlled environment.

1.  **Create a New Google Account:** Use a name like `YourBotTestAccount@gmail.com`.
2.  **Create a YouTube Channel:** Associate a new channel with this account, e.g., "Bot Test Channel".
3.  **Obtain API Credentials:**
    *   Set up a new project in the Google Cloud Console.
    *   Enable the "YouTube Data API v3".
    *   Generate an API Key for your application.
    *   Store this key securely in a `.env.test` file or similar configuration for your testing environment.

---

## Part 2: Enhancing Notification System

### Objective
To implement a near-instantaneous content notification system, given the unreliability of YouTube's PubSubHubbub (WebSub) service.

### Analysis of Options
*   **PubSubHubbub (WebSub):** The official push-based method, but it is often unreliable and may be deprecated or poorly maintained.
*   **API Polling:** Reliable but inefficient. It consumes API quota rapidly and introduces a delay between upload and notification.
*   **Web Scraping:** A practical alternative for a single, targeted channel. Offers high control over polling frequency, allowing for near-instantaneous detection.

### Proposed Solution: Web Scraping
For monitoring a single, specific channel, web scraping is the most viable option for achieving low-latency notifications.

#### Implementation Strategy (using Playwright)

The existing `playwright-browser-service.js` can be leveraged.

```javascript
// Conceptual code for a scraper module
const playwright = require('playwright');

class YouTubeScraper {
  constructor(channelUrl) {
    this.channelUrl = channelUrl;
    this.browser = null;
    this.lastKnownVideoId = null; // Store the ID of the latest video found
  }

  async initialize() {
    this.browser = await playwright.chromium.launch({ headless: true });
    // Find and set the initial latest video
    const latestVideo = await this.fetchLatestVideo();
    if (latestVideo) {
      this.lastKnownVideoId = latestVideo.id;
    }
  }

  async fetchLatestVideo() {
    const page = await this.browser.newPage();
    try {
      await page.goto(this.channelUrl, { waitUntil: 'networkidle' });

      // NOTE: This selector is an EXAMPLE and WILL break. It must be updated
      // by inspecting the YouTube channel's HTML structure.
      const latestVideo = await page.evaluate(() => {
        const firstVideoElement = document.querySelector('ytd-rich-grid-row:first-child #video-title-link');
        if (!firstVideoElement) return null;
        
        const videoId = new URLSearchParams(firstVideoElement.href.split('?')[1]).get('v');
        return {
          id: videoId,
          title: firstVideoElement.innerText,
          url: firstVideoElement.href,
        };
      });
      return latestVideo;
    } catch (error) {
      console.error('Failed to scrape YouTube channel:', error);
      return null;
    } finally {
      await page.close();
    }
  }

  async checkForNewVideo() {
    const latestVideo = await this.fetchLatestVideo();
    if (latestVideo && latestVideo.id !== this.lastKnownVideoId) {
      console.log(`New video found: ${latestVideo.title}`);
      this.lastKnownVideoId = latestVideo.id;
      return latestVideo; // Return the new video object for announcement
    }
    return null;
  }
}

// In your application logic:
// const scraper = new YouTubeScraper('https://www.youtube.com/@YourChannel/videos');
// await scraper.initialize();
// setInterval(async () => {
//   const newVideo = await scraper.checkForNewVideo();
//   if (newVideo) {
//     // Announce the new video to Discord
//   }
// }, 15000); // Check every 15 seconds
```

#### Best Practices & Caveats
*   **Maintainable Selectors:** YouTube's HTML structure changes frequently. Selectors must be monitored and updated. Use robust selectors that are less likely to change (e.g., those with `id` attributes).
*   **Error Handling:** Implement comprehensive error handling and retry logic with exponential backoff.
*   **Anti-Scraping:** Use techniques like User-Agent rotation and proxies if you encounter blocking issues.
*   **Resource Management:** Ensure the browser instance is managed correctly to prevent memory leaks.

---

## Part 3: Improving Discord Rate Limit Handling

### Objective
To build a more resilient system for sending messages to Discord that gracefully handles rate limits, preventing bot downtime and ensuring log messages are delivered without loss.

### Current Implementation Analysis
The current `DiscordTransport` for logging uses a buffering and timed-flush mechanism.

*   **Strengths:**
    *   Reduces the number of API calls by batching messages.
    *   Handles messages longer than 2000 characters using `splitMessage`.
*   **Weaknesses:**
    *   **No Explicit 429 Handling:** Does not detect "Too Many Requests" errors from Discord and dynamically back off.
    *   **Vulnerable to Bursts:** A sudden flood of log messages can exceed the buffer size, leading to rapid sends that can trigger a rate limit.
    *   **No Global Awareness:** The rate limiting is per-transport. Other message-sending activities in the bot are not accounted for, making it easier to hit the global rate limit.

### Proposed Enhancements

#### 1. Implement a Rate-Limited Queue
Instead of a simple timed flush, use a queue to process and send one message (or one message batch) at a time. This smooths out bursts and ensures a steady, controlled flow of messages.

#### 2. Explicit 429 "Too Many Requests" Error Handling
Modify the `flush` method in `DiscordTransport` to specifically handle rate limit errors.

```javascript
// In DiscordTransport.flush()
// ...
try {
  // ... channel.send(part) ...
} catch (error) {
  if (error.code === 429) { // DiscordAPIError: 429 Too Many Requests
    const retryAfter = error.retry_after * 1000; // Convert seconds to ms
    console.warn(`[DiscordTransport] Rate limited by Discord. Retrying after ${retryAfter}ms.`);
    
    // Pause the queue/transport
    this.pause(retryAfter); 

    // Re-add the failed messages to the front of the buffer
    this.buffer.unshift(...messagesToFlush);
  } else {
    console.error('[DiscordTransport] Failed to flush log buffer:', error);
  }
}
```
This requires adding `pause()` functionality to the transport to stop it from sending for the duration specified by Discord.

#### 3. Reduce Logging Verbosity
Audit the codebase to ensure that only necessary information is logged to the Discord transport.
*   **Default Level:** Keep the default log level for the Discord transport at `info` or `warn`.
*   **Command Control:** The `!loglevel` command is excellent for debugging, but ensure it defaults back to a less verbose level on restart.
*   **Avoid Logging in Loops:** Be cautious about placing log statements inside loops that could execute rapidly.