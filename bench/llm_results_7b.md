# Local AI narrator check

Generated 2026-10-02 05:05 by `bench/llm_check.py`. Model `qwen2.5:7b` via Ollama (41% GPU) on Intel64 Family 6 Model 165 Stepping 2, GenuineIntel, temperature 0, bounded JSON schema output. The model writes summary, modus operandi and recommendation; layer and holding paragraphs come from templates.

- Accepted by the validator: **0 / 10** victims (the rest use the template narrative; facts are identical either way)
- First call (model load included): 90.4 s
- Later calls: median 90.4 s, max 90.4 s

| Victim | Result | Seconds | Note |
|---|---|---|---|
| ICIC10000106 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| KKBK10000189 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| KKBK10000217 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| BARB10000071 | template fallback | 90.3 | local AI model unavailable (ReadTimeout) |
| HDFC10000185 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| AIRP10000221 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| AXIS10000188 | template fallback | 90.3 | local AI model unavailable (ReadTimeout) |
| BARB10000127 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| ICIC10000204 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
| PYTM10000271 | template fallback | 90.4 | local AI model unavailable (ReadTimeout) |
