-- Tile delivery SLO metrics by artifact and endpoint group
WITH source_events AS (
  SELECT
    artifact_version,
    CASE
      WHEN request_path LIKE '/tiles/%' THEN '/tiles/{z}/{x}/{y}.mvt'
      WHEN request_path = '/tiles/metadata' THEN '/tiles/metadata'
      WHEN request_path LIKE '/raster/%' THEN '/raster/{styleId}/{z}/{x}/{y}.{format}'
      WHEN request_path LIKE '/static/%' THEN '/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.{format}'
      ELSE request_path
    END AS endpoint_group,
    datetime,
    response_cache_status,
    status_code,
    response_bytes,
    origin_read,
    cache_control AS cache_control,
    service_ttfb_ms,
    total_response_ms
  FROM tile_delivery_events
),
windowed AS (
  SELECT
    artifact_version,
    endpoint_group,
    date_trunc('minute', datetime) AS bucket,
    count(*) AS total_requests,
    sum(if(response_cache_status = 'HIT', 1, 0)) AS cache_hits,
    sum(if(response_cache_status = 'MISS', 1, 0)) AS cache_misses,
    sum(if(origin_read, 1, 0)) AS origin_reads,
    sum(if(status_code >= 400, 1, 0)) AS errors,
    avg(total_response_ms) AS avg_latency_ms,
    approx_percentile(toFloat64(total_response_ms), 0.95) AS p95_latency_ms
  FROM source_events
  GROUP BY artifact_version, endpoint_group, bucket
)
SELECT
  artifact_version,
  endpoint_group,
  bucket,
  total_requests,
  cache_hits,
  cache_misses,
  origin_reads,
  errors,
  round(cache_hits / nullIf(total_requests, 0), 4) AS cache_hit_ratio,
  round(errors / nullIf(total_requests, 0), 4) AS error_rate,
  avg_latency_ms,
  p95_latency_ms
FROM windowed
ORDER BY bucket DESC, artifact_version, endpoint_group;

-- Daily rollup to support 15-minute and day-level trend views
SELECT
  artifact_version,
  endpoint_group,
  toStartOfMinute(datetime) AS bucket,
  count(*) AS total_requests,
  sum(if(response_cache_status = 'HIT', 1, 0)) AS cache_hits,
  sum(if(status_code >= 400, 1, 0)) AS errors,
  sum(if(origin_read, 1, 0)) AS origin_reads
FROM tile_delivery_events
WHERE datetime >= now() - INTERVAL 1 DAY
GROUP BY artifact_version, endpoint_group, bucket;
