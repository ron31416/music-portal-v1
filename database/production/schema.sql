do $$begin raise exception 'do not run this file'; end$$;

create schema if not exists production;

grant usage on schema production to service_role;
