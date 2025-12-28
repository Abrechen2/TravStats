/**
 * API Key Testing Service
 * Tests API keys by making actual API calls
 */

import axios from 'axios';
import logger from '../utils/logger';
import { getApiKey, getOpenSkyCredentials } from './apiKeyResolver';

export interface ApiKeyTestResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * Test OpenAI API key
 */
export async function testOpenAIKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || await getApiKey('openai', userId);
    if (!key) {
      return {
        success: false,
        message: 'No API key provided',
      };
    }

    // Test with a simple completion request
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5,
      },
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: 'API key is valid',
        details: {
          model: response.data.model,
        },
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
    };
  } catch (error: any) {
    if (error.response?.status === 401) {
      return {
        success: false,
        message: 'Invalid API key',
      };
    }
    if (error.response?.status === 429) {
      return {
        success: false,
        message: 'Rate limit exceeded',
      };
    }
    return {
      success: false,
      message: error.response?.data?.error?.message || error.message || 'Unknown error',
    };
  }
}

/**
 * Test Claude API key
 */
export async function testClaudeKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || await getApiKey('claude', userId);
    if (!key) {
      return {
        success: false,
        message: 'No API key provided',
      };
    }

    // Test with a simple message request
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-haiku-20240307',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'test' }],
      },
      {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      return {
        success: true,
        message: 'API key is valid',
        details: {
          model: response.data.model,
        },
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
    };
  } catch (error: any) {
    if (error.response?.status === 401) {
      return {
        success: false,
        message: 'Invalid API key',
      };
    }
    if (error.response?.status === 429) {
      return {
        success: false,
        message: 'Rate limit exceeded',
      };
    }
    return {
      success: false,
      message: error.response?.data?.error?.message || error.message || 'Unknown error',
    };
  }
}

/**
 * Test AirLabs API key
 */
export async function testAirlabsKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || await getApiKey('airlabs', userId);
    if (!key) {
      return {
        success: false,
        message: 'No API key provided',
      };
    }

    // Test with a simple API call
    const response = await axios.get(
      'https://airlabs.co/api/v9/ping',
      {
        params: {
          api_key: key,
        },
        timeout: 10000,
      }
    );

    // AirLabs API returns different response formats
    if (response.status === 200) {
      // Check for success status
      if (response.data?.status === 'success' || response.data?.response) {
        return {
          success: true,
          message: 'API key is valid',
          details: response.data,
        };
      }
      
      // Check for error in response
      if (response.data?.error) {
        const errorMsg = typeof response.data.error === 'string' 
          ? response.data.error 
          : response.data.error.message || 'API error';
        return {
          success: false,
          message: errorMsg,
        };
      }
      
      // If we get 200 but no clear success/error, assume it's valid
      return {
        success: true,
        message: 'API key is valid',
        details: response.data,
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
    };
  } catch (error: any) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      return {
        success: false,
        message: 'Invalid API key',
      };
    }
    // Check for AirLabs error format
    if (error.response?.data?.error) {
      const errorMsg = typeof error.response.data.error === 'string'
        ? error.response.data.error
        : error.response.data.error.message || 'API error';
      return {
        success: false,
        message: errorMsg,
      };
    }
    return {
      success: false,
      message: error.response?.data?.error?.message || error.message || 'Unknown error',
    };
  }
}

/**
 * Test Aviationstack API key
 */
export async function testAviationstackKey(apiKey: string, userId?: string): Promise<ApiKeyTestResult> {
  try {
    const key = apiKey || await getApiKey('aviationstack', userId);
    if (!key) {
      return {
        success: false,
        message: 'No API key provided',
      };
    }

    // Test with a simple API call
    const response = await axios.get(
      'https://api.aviationstack.com/v1/flights',
      {
        params: {
          access_key: key,
          limit: 1,
        },
        timeout: 10000,
      }
    );

    if (response.status === 200) {
      if (response.data?.error) {
        return {
          success: false,
          message: response.data.error.info || 'API error',
        };
      }
      return {
        success: true,
        message: 'API key is valid',
        details: {
          pagination: response.data?.pagination,
        },
      };
    }

    return {
      success: false,
      message: `Unexpected response: ${response.status}`,
    };
  } catch (error: any) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      return {
        success: false,
        message: 'Invalid API key',
      };
    }
    return {
      success: false,
      message: error.response?.data?.error?.info || error.message || 'Unknown error',
    };
  }
}

/**
 * Test OpenSky credentials (OAuth2 only - Client ID + Client Secret)
 */
export async function testOpenSkyCredentials(
  credentials: { clientId?: string; clientSecret?: string; username?: string; password?: string },
  userId?: string
): Promise<ApiKeyTestResult> {
  try {
    // Use provided credentials or get from resolver
    let creds = credentials;
    if (!creds.clientId) {
      const resolved = await getOpenSkyCredentials(userId);
      if (resolved && resolved.clientId) {
        creds = resolved;
      }
    }

    if (!creds.clientId || !creds.clientSecret) {
      return {
        success: false,
        message: 'Client ID and Client Secret are required',
      };
    }

    // Test with OAuth2 (only method supported)
    try {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      });

      const response = await axios.post(
        'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );

      if (response.status === 200 && response.data?.access_token) {
        return {
          success: true,
          message: 'OAuth2 credentials are valid',
        };
      }

      return {
        success: false,
        message: 'Invalid response from authentication server',
      };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return {
          success: false,
          message: 'Invalid OAuth2 credentials - please check Client ID and Client Secret',
        };
      }
      if (error.response?.data?.error_description) {
        return {
          success: false,
          message: error.response.data.error_description,
        };
      }
      return {
        success: false,
        message: error.response?.data?.error || error.message || 'Authentication failed',
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Unknown error',
    };
  }
}

