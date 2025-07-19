import { jest } from '@jest/globals';
import { FetchHttpService } from '../../../src/services/implementations/fetch-http-service.js';

// Mock the global fetch function
global.fetch = jest.fn();

describe('FetchHttpService', () => {
  let httpService;

  beforeEach(() => {
    jest.useFakeTimers();
    fetch.mockClear();
    httpService = new FetchHttpService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should make a GET request successfully', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve({ data: 'test' }),
      text: () => Promise.resolve(JSON.stringify({ data: 'test' })),
      url: 'https://example.com',
    };
    fetch.mockResolvedValue(mockResponse);

    const response = await httpService.get('https://example.com');

    expect(response).toEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      url: 'https://example.com',
      ok: true,
      data: { data: 'test' },
    });
    expect(fetch).toHaveBeenCalledWith('https://example.com', expect.any(Object));
  });

  it('should make a POST request successfully', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve({ data: 'test' }),
      text: () => Promise.resolve(JSON.stringify({ data: 'test' })),
      url: 'https://example.com',
    };
    fetch.mockResolvedValue(mockResponse);

    const body = { key: 'value' };
    const response = await httpService.post('https://example.com', body);

    expect(response).toEqual({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      url: 'https://example.com',
      ok: true,
      data: { data: 'test' },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      })
    );
  });

  it('should return a response object for non-ok responses instead of throwing', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve({ error: 'Not Found' }),
      text: () => Promise.resolve(JSON.stringify({ error: 'Not Found' })),
      url: 'https://example.com/notfound',
    };
    fetch.mockResolvedValue(mockResponse);

    const response = await httpService.get('https://example.com/notfound');

    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
    expect(response.data).toEqual({ error: 'Not Found' });
  });

  it('should throw an error on network failure', async () => {
    const networkError = new Error('Network failure');
    fetch.mockRejectedValue(networkError);

    await expect(httpService.get('https://example.com')).rejects.toThrow('HTTP request failed: Network failure');
  });
});
