-- forgejo#392: the custom AI endpoint's switch (llm_custom_opt_in) is honoured
-- for a LOCAL endpoint too. Until now a local endpoint ran without it, so an
-- instance that works today has the switch off. Data only: switch it on where
-- a local endpoint is configured, so nothing stops working. A non-local
-- endpoint is never touched (that switch is a consent, not a default); after
-- this runs, off means off. Mirrors isLocalLlmHost in llmEndpoint.ts.
UPDATE admin_settings
SET llm_custom_opt_in = true
WHERE llm_custom_opt_in = false
  AND openai_compat_base_url IS NOT NULL
  AND openai_compat_base_url <> ''
  AND (
    WITH h AS (
      SELECT lower(substring(openai_compat_base_url FROM '^[A-Za-z]+://(?:[^/@]*@)?(\[[^\]]+\]|[^/:?#]+)')) AS host
    )
    SELECT CASE
      WHEN host IS NULL THEN false
      WHEN host LIKE '[%' THEN host ~ '^\[(::1\]|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]?:)'
      WHEN host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' THEN
        host ~ '^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
      ELSE host = 'localhost' OR host ~ '\.(local|lan|internal|localhost)$' OR host ~ '\.home\.arpa$' OR host !~ '\.'
    END FROM h
  );
