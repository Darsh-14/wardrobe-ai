-- Derived data the frontend shows but we don't store (see plan: "Derived, not stored").
-- Views run with the caller's rights (security_invoker), so RLS still applies.

-- Wardrobe grid: WardrobeItem incl. "worn often" = top quarter of the user's
-- items by wear_count, and worn at least 3 times.
create view wardrobe_items_view with (security_invoker = true) as
select
  wi.*,
  (wi.wear_count >= 3
   and percent_rank() over (partition by wi.user_id order by wi.wear_count) >= 0.75) as worn_often
from wardrobe_items wi;

-- GET /api/me/stats  (UserStats)
create view user_stats with (security_invoker = true) as
select
  p.id as user_id,
  (select count(*) from wardrobe_items wi where wi.user_id = p.id)                         as wardrobe_count,
  (select count(*) from looks l where l.user_id = p.id and l.saved_at is not null)         as saved_looks,
  (select count(distinct o.worn_on) from outfit_log o where o.user_id = p.id)              as days_styled
from profiles p;

-- GET /api/wardrobe/summary  (CategorySummary[]: the four home tiles)
-- "Shoes & more" groups Shoes, Dresses and Accessories, matching the mock counts (24+12+18+33 = 87).
create view category_summary with (security_invoker = true) as
with grouped as (
  select
    wi.user_id,
    case wi.category
      when 'Tops'      then 'Tops'
      when 'Outerwear' then 'Outerwear'
      when 'Bottoms'   then 'Bottoms'
      else 'Shoes & more'
    end as label,
    coalesce(wi.cutout_path, wi.image_path) as image_path,
    wi.created_at
  from wardrobe_items wi
)
select
  user_id,
  label,
  count(*) as count,
  (array_agg(image_path order by created_at desc))[1] as image_path,
  array_position(array['Tops', 'Outerwear', 'Bottoms', 'Shoes & more'], label) as sort_order
from grouped
group by user_id, label;

-- POST /api/looks/:id/wear  ("Wear This")
-- Logs the look for the day and bumps wear_count on its items, once per look per day.
create function wear_look(p_look_id uuid, p_worn_on date default current_date)
returns boolean
language plpgsql security invoker as $$
declare
  v_user uuid;
  v_inserted int;
begin
  select user_id into v_user from looks where id = p_look_id;
  if v_user is null then
    raise exception 'look % not found', p_look_id using errcode = 'P0002';
  end if;

  insert into outfit_log (user_id, look_id, worn_on)
  values (v_user, p_look_id, p_worn_on)
  on conflict (look_id, worn_on) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return false;  -- already logged today
  end if;

  update wardrobe_items wi
     set wear_count   = wi.wear_count + 1,
         last_worn_on = greatest(wi.last_worn_on, p_worn_on)
    from look_items li
   where li.look_id = p_look_id
     and li.wardrobe_item_id = wi.id;
  return true;
end $$;

-- Used by /api/looks/generate and /api/looks/:id/swap to (re)write a look's items
-- in one statement, keeping the order the LLM returned.
create function set_look_items(p_look_id uuid, p_item_ids uuid[])
returns void
language plpgsql security invoker as $$
declare
  v_user uuid;
begin
  select user_id into v_user from looks where id = p_look_id;
  if v_user is null then
    raise exception 'look % not found', p_look_id using errcode = 'P0002';
  end if;

  delete from look_items where look_id = p_look_id;
  insert into look_items (look_id, user_id, wardrobe_item_id, position)
  select p_look_id, v_user, item_id, (ord - 1)::smallint
    from unnest(p_item_ids) with ordinality as t(item_id, ord);
end $$;
