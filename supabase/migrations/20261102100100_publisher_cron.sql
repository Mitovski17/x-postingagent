-- Runs the publisher every minute, inside Supabase.
-- Works with your computer off. pg_cron calls the publish-due edge function
-- with a random shared secret kept in Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'publisher_cron_secret',
  'Shared secret pg_cron sends to the publish-due edge function'
);

create or replace function public.verify_cron_secret(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    -- $1, not "secret": vault.decrypted_secrets has its own "secret" column
    select 1 from vault.decrypted_secrets s
    where s.name = 'publisher_cron_secret' and s.decrypted_secret = $1
  );
$$;

revoke all on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

select cron.schedule(
  'publish-due-posts',
  '* * * * *',
  $job$
  select net.http_post(
    url     := 'https://xssvfmbkgpchmfimjhdf.supabase.co/functions/v1/publish-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publisher_cron_secret')
    ),
    body    := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $job$
);
