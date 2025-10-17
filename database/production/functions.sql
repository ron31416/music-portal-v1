do $$begin raise exception 'do not run this file'; end$$;


--drop function production.user_upsert;
create function production.user_upsert(
  p_user_id           int,
  p_user_name         text,
  p_user_email        text,
  p_user_first_name   text,
  p_user_last_name    text,
  p_user_role_number  int
) returns int
language plpgsql
as $$
declare
  v_user_id int;
begin
  if p_user_id is null then
    insert into production.site_user (
      user_name,
      user_email, 
      user_first_name, 
      user_last_name,
      user_role_number
    )
    values (
      lower(btrim(p_user_name)),
      lower(btrim(p_user_email)),
      btrim(p_user_first_name),
      btrim(p_user_last_name),
      p_user_role_number
    )
    returning user_id into v_user_id;
    return v_user_id;
  else
    update production.site_user
    set user_name         = lower(btrim(p_user_name)),
        user_email        = lower(btrim(p_user_email)),
        user_first_name   = btrim(p_user_first_name),
        user_last_name    = btrim(p_user_last_name),
        user_role_number  = p_user_role_number,
        updated_datetime  = now()
    where user_id = p_user_id;
        if found then
          return p_user_id;
        else
          raise exception 'user_id % not found', p_user_id
              using errcode = 'P0002';  -- no_data_found
        end if;
    end if;
end
$$;

revoke all on function production.user_upsert(int, text, text, text, text, int) 
  from public, authenticated, anon;
grant execute on function production.user_upsert(int, text, text, text, text, int) 
  to service_role;


--drop function production.user_delete;
create function production.user_delete(
  p_user_id int
)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  delete from production.site_user
  where user_id = p_user_id;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function production.user_delete(int) 
  from public, authenticated, anon;
grant execute on function production.user_delete(int) 
  to service_role;


--drop function production.user_list(text, text);
create or replace function production.user_list(
  p_sort_column     text default 'user_name',
  p_sort_direction  text default 'asc'
)
returns table (
  user_id           int,
  user_name         text,
  user_email        text,
  user_first_name   text,
  user_last_name    text,
  user_role_number  int,
  user_role_name    text,
  inserted_datetime timestamptz,
  updated_datetime  timestamptz
)
language plpgsql
stable
as $$
declare
  order_clause text;
begin
  if p_sort_direction not in ('asc', 'desc') then
    raise exception 'Invalid sort_direction: %, must be "asc" or "desc"', p_sort_direction
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  case p_sort_column
    when 'user_name' then
      order_clause := format('u.user_name %s', p_sort_direction);
    when 'user_email' then
      order_clause := format('u.user_email %s', p_sort_direction);
    when 'user_first_name' then
      order_clause := format('u.user_first_name %s, u.user_last_name asc, u.user_name asc', p_sort_direction);
    when 'user_last_name' then
      order_clause := format('u.user_last_name %s, u.user_first_name asc, u.user_name asc', p_sort_direction);
    when 'user_role_number' then
      order_clause := format('u.user_role_number %s, u.user_name asc', p_sort_direction);
    when 'updated_datetime' then
      order_clause := format('u.updated_datetime %s, u.user_name asc', p_sort_direction);
    when 'inserted_datetime' then
      order_clause := format('u.inserted_datetime %s, u.user_name asc', p_sort_direction);
    else
      order_clause := format('u.user_name %s', p_sort_direction);
  end case;

  return query execute format(
    'select
      u.user_id,
      u.user_name,
      u.user_email,
      u.user_first_name,
      u.user_last_name,
      u.user_role_number,
      ur.user_role_name,
      u.inserted_datetime,
      u.updated_datetime
     from  production.site_user as u
      join production.user_role as ur
        on ur.user_role_number = u.user_role_number
     order by %s', order_clause
  );
end
$$;

revoke all on function production.user_list(text, text) 
  from public, authenticated, anon;
grant execute on function production.user_list(text, text) 
  to service_role;


--drop function production.song_list(text, text);
create or replace function production.song_list(
  p_sort_column     text default 'composer_last_name',
  p_sort_direction  text default 'asc'
)
returns table (
  song_id               int,
  song_title            text,
  composer_first_name   text,
  composer_last_name    text,
  skill_level_number    int,
  skill_level_name      text,
  file_name             text,
  inserted_datetime     timestamptz,
  updated_datetime      timestamptz
)
language plpgsql
stable
as $$
declare
  order_clause text;
begin
  if p_sort_direction not in ('asc', 'desc') then
    raise exception 'Invalid sort_direction: %, must be "asc" or "desc"', p_sort_direction
      using errcode = '22023'; -- invalid_parameter_value
  end if;

  case p_sort_column
    when 'composer_last_name' then
      order_clause := format('s.composer_last_name %s, s.composer_first_name ASC, s.song_title ASC, s.skill_level_number ASC', p_sort_direction);
    when 'composer_first_name' then
      order_clause := format('s.composer_first_name %s, s.composer_last_name ASC, s.song_title ASC, s.skill_level_number ASC', p_sort_direction);
    when 'song_title' then
      order_clause := format('s.song_title %s, s.composer_last_name ASC, s.composer_first_name ASC, s.skill_level_number ASC', p_sort_direction);
    when 'skill_level_name', 'skill_level_number' then
      order_clause := format('s.skill_level_number %s, s.composer_last_name ASC, s.composer_first_name ASC, s.song_title ASC', p_sort_direction);
    when 'updated_datetime' then
      order_clause := format('s.updated_datetime %s, s.composer_last_name ASC, s.composer_first_name ASC, s.song_title ASC, s.skill_level_number ASC', p_sort_direction);
    when 'inserted_datetime' then
      order_clause := format('s.inserted_datetime %s, s.composer_last_name ASC, s.composer_first_name ASC, s.song_title ASC, s.skill_level_number ASC', p_sort_direction);
    when 'file_name' then
      order_clause := format('s.file_name %s', p_sort_direction);
    else
      order_clause := format('s.composer_last_name %s, s.composer_first_name ASC, s.song_title ASC, s.skill_level_number ASC'), p_sort_direction;
  end case;

  return query execute format(
    'select
       s.song_id,
       s.song_title,
       s.composer_first_name,
       s.composer_last_name,
       s.skill_level_number,
       sl.skill_level_name,
       s.file_name,
       s.inserted_datetime,
       s.updated_datetime
     from  production.song as s
      join production.skill_level as sl
        on sl.skill_level_number = s.skill_level_number
     order by %s', order_clause
  );
end
$$;

revoke all on function production.song_list(text, text)
  from public, authenticated, anon;
grant execute on function production.song_list(text, text)
  to service_role;



--drop function production.song_upsert
create function production.song_upsert(
    p_song_id               int,
    p_song_title            text,
    p_composer_first_name   text,
    p_composer_last_name    text,
    p_skill_level_number    int,
    p_file_name             text,
    p_song_mxl              bytea
)
returns int
language plpgsql
as $$
declare
    v_song_id int;
begin
    IF p_song_id IS NULL THEN
        insert into production.song (
            song_title,
            composer_first_name,
            composer_last_name,
            skill_level_number,
            file_name,
            song_mxl
        )
        values (
            p_song_title,
            p_composer_first_name,
            p_composer_last_name,
            p_skill_level_number,
            p_file_name,
            p_song_mxl
        )
        returning song_id into v_song_id;

        return v_song_id;
    else
        update production.song
        set
            song_title           = p_song_title,
            composer_first_name  = p_composer_first_name,
            composer_last_name   = p_composer_last_name,
            skill_level_number   = p_skill_level_number,
            file_name            = p_file_name,
            song_mxl             = p_song_mxl,
            updated_datetime     = now()
        where song_id = p_song_id;

        if found then
            return p_song_id;
        else
            raise exception 'song_id % not found', p_song_id
               using errcode = 'P0002';  -- no_data_found
        end if;
    end if;
end
$$;

revoke all on function production.song_upsert(int, text, text, text, int, text, bytea)
  from public, authenticated, anon;
grant execute on function production.song_upsert(int, text, text, text, int, text, bytea)
  to service_role;


--drop function production.song_delete(int)
create or replace function production.song_delete(
  p_song_id int
)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  delete from production.song as s
  where s.song_id = p_song_id;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function production.song_delete(int)
  from public, authenticated, anon;
grant execute on function production.song_delete(int)
  to service_role;


--drop function production.song_mxl_get(int)
create or replace function production.song_mxl_get(
  p_song_id int
)
returns table (
    song_mxl    bytea
)
language plpgsql
stable
as $$
begin
    return query
    select 
      s.song_mxl
    from  production.song as s
    where s.song_id = p_song_id;
end
$$;

revoke all on function production.song_mxl_get(int)
  from public, authenticated, anon;
grant execute on function production.song_mxl_get(int)
  to service_role;


--drop function production.user_role_list();
create or replace function production.user_role_list()
returns table (
    user_role_number integer,
    user_role_name text
)
as $$
    select
      user_role_number, 
      user_role_name
    from  production.user_role
    order by
      user_role_number;
$$ language sql stable;


--drop function production.skill_level_list();
create or replace function production.skill_level_list()
returns table (
    skill_level_number  integer,
    skill_level_name    text
)
as $$
    select
      skill_level_number, 
      skill_level_name
    from  production.skill_level
    order by
      skill_level_number;
$$ language sql stable;
