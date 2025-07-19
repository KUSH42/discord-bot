/**
 * Test suite for enhanced retweet detection functionality
 */
import { jest } from '@jest/globals';
import { ContentClassifier } from '../../src/core/content-classifier.js';

describe('Enhanced Retweet Detection', () => {
  let classifier;

  beforeEach(() => {
    classifier = new ContentClassifier();
  });

  describe('enhancedRetweetDetection', () => {
    it('should detect retweet using socialContext testid', () => {
      // Mock DOM element with socialContext
      const mockElement = {
        querySelector: jest.fn(selector => {
          if (selector === '[data-testid="socialContext"]') {
            return {
              textContent: 'The Enforcer reposted',
            };
          }
          return null;
        }),
      };

      const result = classifier.enhancedRetweetDetection(mockElement);

      expect(result.isRetweet).toBe(true);
      expect(result.confidence).toBe(0.95);
      expect(result.method).toBe('socialContext');
      expect(result.retweetedBy).toBe('The Enforcer');
    });

    it('should detect retweet using text patterns', () => {
      const mockElement = {
        querySelector: jest.fn(selector => {
          if (selector === '[data-testid="socialContext"]') {
            return null;
          }
          if (selector === '[data-testid="tweetText"], [lang] span, div[dir="ltr"]') {
            return {
              textContent: 'RT @user This is a retweet',
              innerText: 'RT @user This is a retweet',
            };
          }
          return null;
        }),
      };

      const result = classifier.enhancedRetweetDetection(mockElement);

      expect(result.isRetweet).toBe(true);
      expect(result.confidence).toBe(0.85);
      expect(result.method).toBe('textPattern');
    });

    it('should detect retweet using contextual text', () => {
      const mockElement = {
        querySelector: jest.fn(selector => {
          return null; // No specific selectors match
        }),
        textContent: 'User retweeted this content',
      };

      const result = classifier.enhancedRetweetDetection(mockElement);

      expect(result.isRetweet).toBe(true);
      expect(result.confidence).toBe(0.6);
      expect(result.method).toBe('contextualText');
    });

    it('should return false when no retweet indicators found', () => {
      const mockElement = {
        querySelector: jest.fn(() => null),
        textContent: 'This is a regular post',
      };

      const result = classifier.enhancedRetweetDetection(mockElement);

      expect(result.isRetweet).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.method).toBe('no-match');
    });

    it('should handle null element gracefully', () => {
      const result = classifier.enhancedRetweetDetection(null);

      expect(result.isRetweet).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.method).toBe('no-element');
    });
  });

  describe('detectBySocialContext', () => {
    it('should extract retweeted author correctly', () => {
      const mockElement = {
        querySelector: jest.fn(() => ({
          textContent: 'John Doe reposted',
        })),
      };

      const result = classifier.detectBySocialContext(mockElement);

      expect(result.isRetweet).toBe(true);
      expect(result.retweetedBy).toBe('John Doe');
    });

    it('should handle different retweet text patterns', () => {
      const testCases = [
        'The Enforcer reposted',
        'User Name retweeted',
        'Someone reposted this',
        'Another User retweeted this post',
      ];

      testCases.forEach(textContent => {
        const mockElement = {
          querySelector: jest.fn(() => ({ textContent })),
        };

        const result = classifier.detectBySocialContext(mockElement);
        expect(result.isRetweet).toBe(true);
      });
    });
  });

  describe('extractRetweetAuthor', () => {
    it('should extract author from repost text', () => {
      const mockSocialContext = {
        textContent: 'The Enforcer reposted',
      };

      const author = classifier.extractRetweetAuthor(mockSocialContext);
      expect(author).toBe('The Enforcer');
    });

    it('should extract author from retweeted text', () => {
      const mockSocialContext = {
        textContent: 'John Smith retweeted',
      };

      const author = classifier.extractRetweetAuthor(mockSocialContext);
      expect(author).toBe('John Smith');
    });

    it('should handle complex names', () => {
      const mockSocialContext = {
        textContent: 'Dr. Jane Doe-Smith reposted',
      };

      const author = classifier.extractRetweetAuthor(mockSocialContext);
      expect(author).toBe('Dr. Jane Doe-Smith');
    });

    it('should return null for invalid text', () => {
      const mockSocialContext = {
        textContent: 'Invalid text pattern',
      };

      const author = classifier.extractRetweetAuthor(mockSocialContext);
      expect(author).toBe(null);
    });
  });

  describe('isRetweet with enhanced detection', () => {
    it('should use enhanced detection when DOM element is provided', () => {
      const mockElement = {
        querySelector: jest.fn(() => ({
          textContent: 'User reposted',
        })),
      };

      const isRetweet = classifier.isRetweet('Some text', { domElement: mockElement });

      expect(isRetweet).toBe(true);
      expect(mockElement.querySelector).toHaveBeenCalledWith('[data-testid="socialContext"]');
    });

    it('should fallback to text patterns when DOM element not available', () => {
      const isRetweet = classifier.isRetweet('RT @user This is a retweet');
      expect(isRetweet).toBe(true);
    });

    it('should detect reposted text in fallback', () => {
      const isRetweet = classifier.isRetweet('This content was reposted');
      expect(isRetweet).toBe(true);
    });
  });

  describe('getRetweetIndicators with enhanced detection', () => {
    it('should include enhanced detection indicators', () => {
      const mockElement = {
        querySelector: jest.fn(() => ({
          textContent: 'The Enforcer reposted',
        })),
      };

      const indicators = classifier.getRetweetIndicators('text', { domElement: mockElement });

      expect(indicators).toContain('Enhanced detection: socialContext (confidence: 0.95)');
      expect(indicators).toContain('Retweeted by: The Enforcer');
    });

    it('should include reposted text indicator', () => {
      const indicators = classifier.getRetweetIndicators('This was reposted');

      expect(indicators).toContain('Contains "reposted" text');
    });
  });
});
