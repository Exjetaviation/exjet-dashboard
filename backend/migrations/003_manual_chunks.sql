-- 003_manual_chunks.sql
-- Vector store for the Exjet General Operations Manual (and any future
-- operational manuals). Reset by `node scripts/ingest-manuals.js` —
-- each run deletes rows for the manual being ingested before inserting
-- the freshly chunked + embedded content, so the script is idempotent.
--
-- Embedding dim 1024 matches voyage-3 / voyage-3-large output.

create extension if not exists vector;

create table if not exists public.manual_chunks (
    id           uuid        primary key default gen_random_uuid(),
    manual_name  text        not null,
    section      text,
    page_number  integer,
    chunk_index  integer     not null,
    content      text        not null,
    embedding    vector(1024) not null,
    created_at   timestamptz not null default now()
);

create index if not exists manual_chunks_manual_name_idx
    on public.manual_chunks (manual_name);

-- HNSW for fast cosine-similarity queries. m / ef_construction at the
-- pgvector defaults (16 / 64) are fine for a few thousand chunks; revisit
-- if we ever ingest a much larger corpus.
create index if not exists manual_chunks_embedding_hnsw_idx
    on public.manual_chunks
    using hnsw (embedding vector_cosine_ops);

-- RPC the search_manuals tool calls: cosine-distance search with an
-- optional manual_name filter. `match_count` is server-clamped so a
-- careless caller can't pull thousands of rows back.
create or replace function public.match_manual_chunks(
    query_embedding vector(1024),
    match_count     integer default 3,
    manual_filter   text    default null
)
returns table (
    id          uuid,
    manual_name text,
    section     text,
    page_number integer,
    chunk_index integer,
    content     text,
    score       float
)
language sql stable as $$
    select
        m.id,
        m.manual_name,
        m.section,
        m.page_number,
        m.chunk_index,
        m.content,
        1 - (m.embedding <=> query_embedding) as score
    from public.manual_chunks m
    where (manual_filter is null or m.manual_name = manual_filter)
    order by m.embedding <=> query_embedding
    limit least(greatest(coalesce(match_count, 3), 1), 5);
$$;
