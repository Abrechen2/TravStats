import { prisma } from '../db';
import logger from '../utils/logger';
import { storePatternSuggestions } from './patternUpdater';

export interface PatternSuggestion {
  pattern: string;
  field: string;
  confidence: number;
  examples: string[];
  issue: string;
}

/**
 * Analyze parser feedback to suggest pattern improvements
 */
export async function analyzeFeedbackForPatterns(
  days: number = 30
): Promise<PatternSuggestion[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const events = await prisma.analyticsEvent.findMany({
    where: {
      type: 'parser_feedback',
      createdAt: {
        gte: since,
      },
    },
  });

  const suggestions: PatternSuggestion[] = [];
  const issuePatterns: Record<string, { count: number; examples: string[] }> = {};

  // Collect common issues and their examples
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;

    if (payload.issues && Array.isArray(payload.issues)) {
      for (const issue of payload.issues) {
        if (typeof issue !== 'string') continue;
        if (!issuePatterns[issue]) {
          issuePatterns[issue] = { count: 0, examples: [] };
        }
        issuePatterns[issue].count++;

        // Collect examples from parsed result
        if (payload.parsedResult && Array.isArray(payload.parsedResult)) {
          for (const flight of payload.parsedResult) {
            const f = flight as Record<string, unknown>;
            if (issue.includes('flightNumber') && typeof f.flightNumber === 'string') {
              issuePatterns[issue].examples.push(f.flightNumber);
            } else if (issue.includes('departureCode') && typeof f.departureCode === 'string') {
              issuePatterns[issue].examples.push(f.departureCode);
            } else if (issue.includes('arrivalCode') && typeof f.arrivalCode === 'string') {
              issuePatterns[issue].examples.push(f.arrivalCode);
            } else if (issue.includes('pnr') && typeof f.pnr === 'string') {
              issuePatterns[issue].examples.push(f.pnr);
            }
          }
        }
      }
    }
  }

  // Generate pattern suggestions based on common issues
  for (const [issue, data] of Object.entries(issuePatterns)) {
    if (data.count < 3) continue; // Only suggest for issues that appear at least 3 times

    const uniqueExamples = [...new Set(data.examples)].slice(0, 10);
    
    if (issue.includes('flightNumber') && uniqueExamples.length > 0) {
      // Analyze flight number patterns
      const patterns = analyzeFlightNumberPatterns(uniqueExamples);
      for (const pattern of patterns) {
        suggestions.push({
          pattern: pattern.regex,
          field: 'flightNumber',
          confidence: pattern.confidence,
          examples: uniqueExamples,
          issue: 'Missing or incorrect flight number',
        });
      }
    } else if (issue.includes('pnr') && uniqueExamples.length > 0) {
      // Analyze PNR patterns
      const pattern = analyzePNRPatterns(uniqueExamples);
      if (pattern) {
        suggestions.push({
          pattern: pattern.regex,
          field: 'pnr',
          confidence: pattern.confidence,
          examples: uniqueExamples,
          issue: 'Missing or incorrect PNR',
        });
      }
    } else if ((issue.includes('departureCode') || issue.includes('arrivalCode')) && uniqueExamples.length > 0) {
      // Analyze airport code patterns
      const pattern = analyzeAirportCodePatterns(uniqueExamples);
      if (pattern) {
        suggestions.push({
          pattern: pattern.regex,
          field: issue.includes('departureCode') ? 'departureCode' : 'arrivalCode',
          confidence: pattern.confidence,
          examples: uniqueExamples,
          issue: `Missing or incorrect ${issue.includes('departureCode') ? 'departure' : 'arrival'} airport code`,
        });
      }
    }
  }

  // Sort by confidence and count
  suggestions.sort((a, b) => {
    const aScore = a.confidence * (issuePatterns[a.issue]?.count || 0);
    const bScore = b.confidence * (issuePatterns[b.issue]?.count || 0);
    return bScore - aScore;
  });

  const topSuggestions = suggestions.slice(0, 20); // Top 20 suggestions

  // Auto-store high-confidence suggestions for potential auto-application
  const highConfidenceSuggestions = topSuggestions.filter(s => s.confidence >= 0.8);
  if (highConfidenceSuggestions.length > 0) {
    storePatternSuggestions(highConfidenceSuggestions).catch(err => {
      logger.warn({ error: err }, '[Pattern Analyzer] Failed to store pattern suggestions');
    });
  }

  return topSuggestions;
}

/**
 * Analyze flight number patterns from examples
 */
function analyzeFlightNumberPatterns(examples: string[]): Array<{ regex: string; confidence: number }> {
  const patterns: Array<{ regex: string; confidence: number }> = [];
  
  // Check for common patterns
  const airlineCodes = new Set<string>();
  const numberLengths = new Set<number>();
  
  for (const example of examples) {
    const match = example.match(/^([A-Z]{2,3})(\d+)$/);
    if (match) {
      airlineCodes.add(match[1]);
      numberLengths.add(match[2].length);
    }
  }

  if (airlineCodes.size > 0 && numberLengths.size > 0) {
    const avgLength = Array.from(numberLengths).reduce((a, b) => a + b, 0) / numberLengths.size;
    const minLength = Math.min(...numberLengths);
    const maxLength = Math.max(...numberLengths);
    
    // Generate pattern based on observed patterns
    if (minLength === maxLength) {
      patterns.push({
        regex: `\\b([A-Z]{2,3})\\s*(\\d{${minLength}})\\b`,
        confidence: 0.8,
      });
    } else {
      patterns.push({
        regex: `\\b([A-Z]{2,3})\\s*(\\d{${minLength},${maxLength}})\\b`,
        confidence: 0.7,
      });
    }
  }

  return patterns;
}

/**
 * Analyze PNR patterns from examples
 */
function analyzePNRPatterns(examples: string[]): { regex: string; confidence: number } | null {
  if (examples.length === 0) return null;

  // Check if all examples have same length
  const lengths = examples.map(e => e.length);
  const uniqueLengths = [...new Set(lengths)];
  
  if (uniqueLengths.length === 1) {
    const length = uniqueLengths[0];
    // Check if alphanumeric
    const isAlphanumeric = examples.every(e => /^[A-Z0-9]+$/.test(e));
    
    if (isAlphanumeric) {
      return {
        regex: `\\b([A-Z0-9]{${length}})\\b`,
        confidence: 0.9,
      };
    }
  }

  // Fallback: flexible pattern
  return {
    regex: `\\b([A-Z0-9]{6,8})\\b`,
    confidence: 0.5,
  };
}

/**
 * Analyze airport code patterns from examples
 */
function analyzeAirportCodePatterns(examples: string[]): { regex: string; confidence: number } | null {
  if (examples.length === 0) return null;

  // Check if all are 3-letter codes
  const allThreeLetters = examples.every(e => /^[A-Z]{3}$/.test(e));
  
  if (allThreeLetters) {
    return {
      regex: `\\b([A-Z]{3})\\b`,
      confidence: 0.8,
    };
  }

  return null;
}

/**
 * Get pattern analysis summary
 */
export async function getPatternAnalysisSummary(days: number = 30): Promise<{
  totalIssues: number;
  suggestions: number;
  topIssues: Array<{ issue: string; count: number }>;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const events = await prisma.analyticsEvent.findMany({
    where: {
      type: 'parser_feedback',
      createdAt: {
        gte: since,
      },
    },
  });

  const issueCounts: Record<string, number> = {};

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (payload.issues && Array.isArray(payload.issues)) {
      for (const issue of payload.issues) {
        if (typeof issue !== 'string') continue;
        issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      }
    }
  }

  const topIssues = Object.entries(issueCounts)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const suggestions = await analyzeFeedbackForPatterns(days);

  return {
    totalIssues: Object.values(issueCounts).reduce((a, b) => a + b, 0),
    suggestions: suggestions.length,
    topIssues,
  };
}

