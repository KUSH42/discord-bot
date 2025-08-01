/**
 * Browser helper functions for tweet extraction
 * These functions are injected into the browser context to assist with DOM manipulation and data extraction
 */

/**
 * Get browser helper functions for tweet extraction
 * These can be injected into browser context to reduce code duplication
 * @returns {string} JavaScript code to inject into browser
 */
export function getBrowserTweetHelperFunctions() {
  return `
    // Helper function to find tweet articles
    window.findTweetArticles = function() {
      function robustQuerySelector(selectors, context = document) {
        for (const selector of selectors) {
          try {
            const elements = context.querySelectorAll(selector);
            if (elements.length > 0) {
              console.log('SUCCESS: Using selector "' + selector + '" found ' + elements.length + ' elements');
              return elements;
            }
          } catch (error) {
            console.log('FAILED: Selector "' + selector + '" error:', error.message);
          }
        }
        return [];
      }
      
      const articleSelectors = [
        'article[data-testid="tweet"]',
        'div[data-testid="cellInnerDiv"] article',
        'article[role="article"]',
        'article[tabindex="-1"]',
        'article',
      ];
      
      const articles = robustQuerySelector(articleSelectors);
      return { articles, workingSelector: articles.length > 0 ? 'robust-selection' : null };
    };
    
    // Helper function to extract tweet URL from article
    window.extractTweetUrl = function(article) {
      const linkSelectors = [
        'a[href*="/status/"]',
        'time[datetime] ~ a[href*="/status/"]',
        'time[datetime]',
        '[data-testid="User-Name"] ~ * a[href*="/status/"]',
      ];
      
      for (const selector of linkSelectors) {
        const element = article.querySelector(selector);
        if (element) {
          if (element.href && element.href.includes('/status/')) {
            return element.href;
          } else if (element.tagName === 'TIME' && element.parentElement && element.parentElement.href) {
            return element.parentElement.href;
          }
        }
      }
      
      // Fallback
      const allLinks = article.querySelectorAll('a[href*="/status/"]');
      return allLinks.length > 0 ? allLinks[0].href : null;
    };
    
    // Helper function to extract author information
    window.extractAuthorInfo = function(article, url) {
      let author = 'Unknown';
      let authorDisplayName = null;
      let retweetedBy = null;
      
      // Method 1: Extract from URL (most reliable)
      if (url) {
        const usernameMatch = url.match(/\\/([^/]+)\\/status/);
        if (usernameMatch && usernameMatch[1]) {
          author = usernameMatch[1];
        }
      }
      
      // Method 1.5: Extract display name from User-Name element
      try {
        const userNameElement = article.querySelector('[data-testid="User-Name"]');
        if (userNameElement) {
          // Look for the display name (usually the first text node or span)
          const displayNameSpan = userNameElement.querySelector('span');
          if (displayNameSpan && displayNameSpan.textContent) {
            authorDisplayName = displayNameSpan.textContent.trim();
          }
        }
      } catch (error) {
        // Display name extraction failed, continue with username
      }
      
      // Method 2: Check for social context (retweets) - TEXT PARSING PRIORITY
      const socialContext = article.querySelector('[data-testid="socialContext"]');
      if (socialContext && socialContext.innerText.includes('reposted')) {
        // Primary method: Parse the social context text directly (more reliable)
        if (socialContext.innerText) {
          // Pattern: "Username reposted" or "Display Name reposted"
          const repostMatch = socialContext.innerText.match(/^(.+?)\\s+reposted/);
          if (repostMatch && repostMatch[1]) {
            let username = repostMatch[1].replace('@', '').trim(); // Remove @ if present
            
            // Convert display name to username if needed
            // "The Enforcer" -> "ItsTheEnforcer" mapping
            if (username === 'The Enforcer') {
              username = 'ItsTheEnforcer';
            }
            
            retweetedBy = username;
          }
        }
        
        // Fallback method: Try to find the retweeter link (less reliable due to x.com issue)
        if (!retweetedBy) {
          const repostLinks = article.querySelectorAll('a[href^="/"]');
          for (const link of repostLinks) {
            if (link.textContent && link.textContent.includes('reposted')) {
              const retweetUser = link.href.match(/\\/([^/?]+)/)?.[1];
              if (retweetUser && retweetUser !== 'x.com' && retweetUser !== 'twitter.com') {
                retweetedBy = retweetUser;
                break;
              }
            }
          }
        }
      }
      
      return { author, authorDisplayName, retweetedBy };
    };
    
    // Helper function to extract tweet text
    window.extractTweetText = function(article) {
      const textSelectors = [
        '[data-testid="tweetText"]',
        '[data-testid="tweetText"] span',
        'div[lang] span',
        'div[dir="ltr"] span',
      ];
      
      for (const selector of textSelectors) {
        const textElement = article.querySelector(selector);
        if (textElement && textElement.innerText && textElement.innerText.trim()) {
          return textElement.innerText.trim();
        }
      }
      
      return '';
    };
    
    // Helper function to extract timestamp
    window.extractTimestamp = function(article) {
      const timeElement = article.querySelector('time');
      if (timeElement) {
        const datetime = timeElement.getAttribute('datetime');
        if (datetime && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/.test(datetime)) {
          return datetime;
        }
      }
      return null;
    };

    // Helper function for debugging when no articles are found
    window.debugNoArticlesFound = function() {
      return {
        bodyText: document.body.innerText || '',
        currentUrl: window.location.href,
        searchIndicators: [],
        authIssues: [],
      };
    };

    // Helper function to try fallback selectors
    window.tryFallbackSelectors = function() {
      const fallbackSelectors = [
        '[data-testid*="tweet"]',
        '[role="article"]',
        'article',
        '[data-testid="cellInnerDiv"] > div',
      ];
      
      for (const selector of fallbackSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            console.log('FALLBACK SUCCESS: Found ' + elements.length + ' elements with selector "' + selector + '"');
            return Array.from(elements);
          }
        } catch (error) {
          console.log('FALLBACK FAILED: Selector "' + selector + '" error:', error.message);
        }
      }
      
      return [];
    };
  `;
}

/**
 * Additional debugging helper functions for browser context
 * @returns {string} JavaScript code for debugging functionality
 */
export function getBrowserDebugHelperFunctions() {
  return `
    // Debug function to analyze current page state
    window.debugPageState = function() {
      return {
        url: window.location.href,
        title: document.title,
        articleCount: document.querySelectorAll('article').length,
        tweetCount: document.querySelectorAll('[data-testid="tweet"]').length,
        bodySnippet: document.body.innerText.substring(0, 200),
        hasLoginForm: !!document.querySelector('input[type="password"]'),
        hasRateLimitMessage: document.body.innerText.includes('rate limit'),
      };
    };

    // Debug function to log selector performance
    window.benchmarkSelectors = function(selectors, context = document) {
      const results = [];
      for (const selector of selectors) {
        const start = performance.now();
        try {
          const elements = context.querySelectorAll(selector);
          const end = performance.now();
          results.push({
            selector,
            found: elements.length,
            timeMs: Math.round(end - start * 100) / 100,
            success: true
          });
        } catch (error) {
          const end = performance.now();
          results.push({
            selector,
            found: 0,
            timeMs: Math.round(end - start * 100) / 100,
            success: false,
            error: error.message
          });
        }
      }
      return results;
    };
  `;
}
