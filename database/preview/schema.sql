do $$begin raise exception 'do not run this file'; end$$;

create schema if not exists preview;

grant usage on schema preview to service_role;
