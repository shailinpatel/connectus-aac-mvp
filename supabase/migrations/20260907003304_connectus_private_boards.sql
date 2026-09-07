-- One owner per board for this release. Shared-caregiver invitations are deferred.
create schema if not exists connectus_private;
revoke all on schema connectus_private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table public.boards (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null default 'My communication board',
 created_at timestamptz not null default now()
);
create table public.categories (
 board_id uuid not null references public.boards(id) on delete cascade,
 id text not null check(length(id) between 1 and 80),
 name text not null check(length(trim(name)) between 1 and 32),
 color text not null check(color in ('blue','peach','rose','green','yellow','purple','teal','sand')),
 sort_order integer not null,
 primary key(board_id,id)
);
create table public.tiles (
 board_id uuid not null references public.boards(id) on delete cascade,
 id text not null check(length(id) between 1 and 80),
 category_id text not null,
 text text not null check(length(trim(text)) between 1 and 120),
 symbol text not null check(symbol ~ '^[a-z_]+$' and length(symbol) <= 40),
 photo_id uuid,
 is_favorite boolean not null default false,
 sort_order integer not null,
 primary key(board_id,id),
 foreign key(board_id,category_id) references public.categories(board_id,id)
);
create index tiles_category_idx on public.tiles(board_id,category_id,sort_order);
create unique index tiles_photo_idx on public.tiles(photo_id) where photo_id is not null;
create table connectus_private.caregiver (
 board_id uuid primary key references public.boards(id) on delete cascade,
 pin_hash text not null,
 failed_attempts integer not null default 0,
 locked_until timestamptz
);
create table connectus_private.sessions (
 token_hash text primary key,
 board_id uuid not null references public.boards(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 auth_session_id text not null,
 expires_at timestamptz not null
);
create index sessions_board_idx on connectus_private.sessions(board_id);
create index sessions_user_idx on connectus_private.sessions(user_id);
revoke all on all tables in schema connectus_private from public,anon,authenticated;
alter table public.boards enable row level security;
alter table public.categories enable row level security;
alter table public.tiles enable row level security;
revoke all on public.boards,public.categories,public.tiles from anon,authenticated;
grant select on public.boards,public.categories,public.tiles to authenticated;
create policy owner_board_read on public.boards for select to authenticated using(owner_id=(select auth.uid()));
create policy owner_category_read on public.categories for select to authenticated using(board_id in (select id from public.boards where owner_id=(select auth.uid())));
create policy owner_tile_read on public.tiles for select to authenticated using(board_id in (select id from public.boards where owner_id=(select auth.uid())));

create function connectus_private.unlocked(b uuid, token text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from connectus_private.sessions s
 join public.boards b on b.id=s.board_id
 where s.board_id=$1 and b.owner_id=auth.uid() and s.user_id=auth.uid()
 and s.auth_session_id=coalesce(auth.jwt()->>'session_id','')
 and s.token_hash=encode(extensions.digest(coalesce($2,''),'sha256'),'hex') and s.expires_at>now());
$$;
revoke all on function connectus_private.unlocked(uuid,text) from public,anon,authenticated;

-- Called only with an authenticated user's JWT. Seed data below is versioned.
create function public.connectus_board() returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.boards; result jsonb;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise insufficient_privilege using message='Sign in to open your board.'; end if;
 insert into public.boards(owner_id) values(auth.uid()) on conflict(owner_id) do nothing;
 select * into b from public.boards where owner_id=auth.uid() for update;
 -- Seed exactly once: an empty customized board must not be repopulated.
 if not exists(select 1 from connectus_private.initialized where board_id=b.id) then
  insert into public.categories(board_id,id,name,color,sort_order)
  select b.id,c->>'id',c->>'name',c->>'color',(c->>'sortOrder')::int from jsonb_array_elements(connectus_private.seed()->'categories') c;
  insert into public.tiles(board_id,id,category_id,text,symbol,is_favorite,sort_order)
  select b.id,t->>'id',t->>'categoryId',t->>'text',t->>'symbol',(t->>'isFavorite')::boolean,(t->>'sortOrder')::int from jsonb_array_elements(connectus_private.seed()->'tiles') t;
  insert into connectus_private.initialized values(b.id);
 end if;
 select jsonb_build_object('id',b.id,'ownerId',b.owner_id,'name',b.name,
  'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'color',c.color,'sortOrder',c.sort_order) order by c.sort_order,c.id) from public.categories c where c.board_id=b.id),'[]'::jsonb),
  'tiles',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'categoryId',t.category_id,'text',t.text,'symbol',t.symbol,'photoId',t.photo_id,'isFavorite',t.is_favorite,'sortOrder',t.sort_order) order by t.sort_order,t.id) from public.tiles t where t.board_id=b.id),'[]'::jsonb)) into result;
 return result;
end $$;
create table connectus_private.initialized(board_id uuid primary key references public.boards(id) on delete cascade);
revoke all on connectus_private.initialized from public,anon,authenticated;

create function public.connectus_caregiver(action text, token text default '', pin text default '', new_pin text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid; c connectus_private.caregiver; attempts integer;
begin
 select id into b from public.boards where owner_id=auth.uid() for update;
 if b is null then raise insufficient_privilege using message='Sign in to open your board.'; end if;
 select * into c from connectus_private.caregiver where board_id=b;
 if action='status' then return jsonb_build_object('configured',c.board_id is not null,'unlocked',connectus_private.unlocked(b,token)); end if;
 if action='lock' then
  delete from connectus_private.sessions where token_hash=encode(extensions.digest(token,'sha256'),'hex') and board_id=b;
  return jsonb_build_object('unlocked',false);
 end if;
 if action not in ('setup','unlock','change') or pin !~ '^[0-9]{4,8}$' or length(token)<>64 then return jsonb_build_object('error','Use a PIN with 4 to 8 digits.','status',400); end if;
 if action='setup' then
  if c.board_id is not null then return jsonb_build_object('error','A caregiver PIN is already set.','status',409); end if;
  insert into connectus_private.caregiver(board_id,pin_hash) values(b,extensions.crypt(pin,extensions.gen_salt('bf',10)));
 else
  if c.board_id is null then return jsonb_build_object('error','Create your caregiver PIN first.','status',400); end if;
  if c.locked_until>now() then return jsonb_build_object('error','Too many attempts. Wait 5 minutes before trying again.','status',429); end if;
  if extensions.crypt(pin,c.pin_hash)<>c.pin_hash then
   attempts:=case when c.locked_until is not null then 1 else c.failed_attempts+1 end;
   update connectus_private.caregiver set failed_attempts=attempts,locked_until=case when attempts>=5 then now()+interval '5 minutes' else null end where board_id=b;
   -- Return an error value, not an exception, so the attempt counter commits.
   return jsonb_build_object('error','That PIN was not correct. Try again.','status',401);
  end if;
  if action='change' then
   if new_pin !~ '^[0-9]{4,8}$' then return jsonb_build_object('error','Use a PIN with 4 to 8 digits.','status',400); end if;
   update connectus_private.caregiver set pin_hash=extensions.crypt(new_pin,extensions.gen_salt('bf',10)) where board_id=b;
   delete from connectus_private.sessions where board_id=b;
  end if;
  update connectus_private.caregiver set failed_attempts=0,locked_until=null where board_id=b;
 end if;
 delete from connectus_private.sessions where expires_at<=now() and board_id=b;
 insert into connectus_private.sessions(token_hash,board_id,user_id,auth_session_id,expires_at)
 values(encode(extensions.digest(token,'sha256'),'hex'),b,auth.uid(),coalesce(auth.jwt()->>'session_id',''),now()+interval '1 hour');
 return jsonb_build_object('configured',true,'unlocked',true);
end $$;

create function public.connectus_mutate(kind text, payload jsonb, token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid; old_photo uuid; new_photo uuid; tile_id text; c_id text;
begin
 select id into b from public.boards where owner_id=auth.uid() for update;
 if b is null or not connectus_private.unlocked(b,token) then raise insufficient_privilege using message='Unlock caregiver mode to make changes.'; end if;
 if kind in ('tile-create','tile-update') then
  c_id:=payload->>'categoryId';
  if not exists(select 1 from public.categories where board_id=b and id=c_id) then raise check_violation using message='Choose an existing category.'; end if;
  tile_id:=case when kind='tile-create' then gen_random_uuid()::text else payload->>'id' end;
  if kind='tile-update' then
   select photo_id into old_photo from public.tiles where board_id=b and id=tile_id;
   if not found then raise no_data_found using message='That tile no longer exists.'; end if;
  end if;
  new_photo:=case when payload ? 'photoId' then (payload->>'photoId')::uuid when coalesce((payload->>'removePhoto')::boolean,false) then null else old_photo end;
  if kind='tile-create' then
   insert into public.tiles(board_id,id,category_id,text,symbol,photo_id,is_favorite,sort_order)
   values(b,tile_id,c_id,payload->>'text',payload->>'symbol',new_photo,(payload->>'isFavorite')::boolean,(select coalesce(max(sort_order),-1)+1 from public.tiles where board_id=b and category_id=c_id));
  else
   update public.tiles set category_id=c_id,text=payload->>'text',symbol=payload->>'symbol',photo_id=new_photo,is_favorite=(payload->>'isFavorite')::boolean where board_id=b and id=tile_id;
  end if;
 elsif kind='tile-delete' then
  delete from public.tiles where board_id=b and id=payload->>'id' returning photo_id into old_photo;
  if not found then raise no_data_found using message='That tile has already been removed.'; end if;
 elsif kind='category-create' then
  insert into public.categories(board_id,id,name,color,sort_order) values(b,gen_random_uuid()::text,payload->>'name',payload->>'color',(select coalesce(max(sort_order),-1)+1 from public.categories where board_id=b));
 elsif kind='category-delete' then
  if exists(select 1 from public.tiles where board_id=b and category_id=payload->>'id') then raise check_violation using message='Move or remove the tiles in this category first.'; end if;
  if (select count(*) from public.categories where board_id=b)<=1 then raise check_violation using message='Keep at least one category on your board.'; end if;
  delete from public.categories where board_id=b and id=payload->>'id';
 else raise check_violation using message='Unknown board change.';
 end if;
 return jsonb_build_object('oldPhotoId',case when old_photo is distinct from new_photo then old_photo else null end);
end $$;

revoke all on function public.connectus_board() from public,anon;
revoke all on function public.connectus_caregiver(text,text,text,text) from public,anon;
revoke all on function public.connectus_mutate(text,jsonb,text) from public,anon;
grant execute on function public.connectus_board(),public.connectus_caregiver(text,text,text,text),public.connectus_mutate(text,jsonb,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('board-photos','board-photos',false,5242880,array['image/webp']);
create policy board_photo_read on storage.objects for select to authenticated using(bucket_id='board-photos' and (storage.foldername(name))[1] in (select id::text from public.boards where owner_id=(select auth.uid())));
create policy board_photo_upload on storage.objects for insert to authenticated with check(bucket_id='board-photos' and (storage.foldername(name))[1] in (select id::text from public.boards where owner_id=(select auth.uid())));
create policy board_photo_remove on storage.objects for delete to authenticated using(bucket_id='board-photos' and (storage.foldername(name))[1] in (select id::text from public.boards where owner_id=(select auth.uid())));

create function connectus_private.seed() returns jsonb language sql immutable set search_path='' as $seedfn$ select $seed${"id":"local-board","name":"My communication board","categories":[{"id":"1","name":"Core Words","color":"blue","sortOrder":0},{"id":"2","name":"Basics","color":"peach","sortOrder":1},{"id":"3","name":"Feelings","color":"rose","sortOrder":2},{"id":"4","name":"Needs","color":"green","sortOrder":3},{"id":"5","name":"Food & Drink","color":"yellow","sortOrder":4},{"id":"6","name":"People","color":"purple","sortOrder":5},{"id":"7","name":"Activities","color":"teal","sortOrder":6},{"id":"8","name":"School","color":"sand","sortOrder":7}],"tiles":[{"id":"1","categoryId":"1","text":"More","symbol":"more","photoId":null,"isFavorite":true,"sortOrder":0},{"id":"2","categoryId":"1","text":"Help","symbol":"help","photoId":null,"isFavorite":true,"sortOrder":1},{"id":"3","categoryId":"1","text":"Stop","symbol":"stop","photoId":null,"isFavorite":true,"sortOrder":2},{"id":"4","categoryId":"1","text":"Go","symbol":"go","photoId":null,"isFavorite":true,"sortOrder":3},{"id":"5","categoryId":"1","text":"Want","symbol":"want","photoId":null,"isFavorite":true,"sortOrder":4},{"id":"6","categoryId":"1","text":"Like","symbol":"like","photoId":null,"isFavorite":false,"sortOrder":5},{"id":"7","categoryId":"1","text":"Don't like","symbol":"dislike","photoId":null,"isFavorite":false,"sortOrder":6},{"id":"8","categoryId":"1","text":"Again","symbol":"again","photoId":null,"isFavorite":false,"sortOrder":7},{"id":"9","categoryId":"1","text":"All done","symbol":"all_done","photoId":null,"isFavorite":true,"sortOrder":8},{"id":"10","categoryId":"1","text":"Yes","symbol":"yes","photoId":null,"isFavorite":true,"sortOrder":9},{"id":"11","categoryId":"1","text":"No","symbol":"no","photoId":null,"isFavorite":true,"sortOrder":10},{"id":"12","categoryId":"1","text":"Mine","symbol":"want","photoId":null,"isFavorite":false,"sortOrder":11},{"id":"13","categoryId":"1","text":"My","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":12},{"id":"14","categoryId":"1","text":"You","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":13},{"id":"15","categoryId":"1","text":"It","symbol":"it","photoId":null,"isFavorite":false,"sortOrder":14},{"id":"16","categoryId":"1","text":"Here","symbol":"map","photoId":null,"isFavorite":false,"sortOrder":15},{"id":"17","categoryId":"1","text":"There","symbol":"map","photoId":null,"isFavorite":false,"sortOrder":16},{"id":"18","categoryId":"1","text":"In","symbol":"down","photoId":null,"isFavorite":false,"sortOrder":17},{"id":"19","categoryId":"1","text":"Out","symbol":"up","photoId":null,"isFavorite":false,"sortOrder":18},{"id":"20","categoryId":"1","text":"Up","symbol":"up","photoId":null,"isFavorite":false,"sortOrder":19},{"id":"21","categoryId":"1","text":"Down","symbol":"down","photoId":null,"isFavorite":false,"sortOrder":20},{"id":"22","categoryId":"1","text":"On","symbol":"on","photoId":null,"isFavorite":false,"sortOrder":21},{"id":"23","categoryId":"1","text":"Off","symbol":"off","photoId":null,"isFavorite":false,"sortOrder":22},{"id":"24","categoryId":"1","text":"Open","symbol":"door","photoId":null,"isFavorite":false,"sortOrder":23},{"id":"25","categoryId":"1","text":"Close","symbol":"door","photoId":null,"isFavorite":false,"sortOrder":24},{"id":"26","categoryId":"1","text":"Eat","symbol":"eat","photoId":null,"isFavorite":false,"sortOrder":25},{"id":"27","categoryId":"1","text":"Drink","symbol":"drink","photoId":null,"isFavorite":false,"sortOrder":26},{"id":"28","categoryId":"1","text":"Play","symbol":"play","photoId":null,"isFavorite":false,"sortOrder":27},{"id":"29","categoryId":"1","text":"Look","symbol":"look","photoId":null,"isFavorite":false,"sortOrder":28},{"id":"30","categoryId":"1","text":"Read","symbol":"book","photoId":null,"isFavorite":false,"sortOrder":29},{"id":"31","categoryId":"1","text":"Wash","symbol":"wash","photoId":null,"isFavorite":false,"sortOrder":30},{"id":"32","categoryId":"1","text":"Need","symbol":"want","photoId":null,"isFavorite":false,"sortOrder":31},{"id":"33","categoryId":"1","text":"Hello","symbol":"hello","photoId":null,"isFavorite":true,"sortOrder":32},{"id":"34","categoryId":"1","text":"Goodbye","symbol":"goodbye","photoId":null,"isFavorite":false,"sortOrder":33},{"id":"35","categoryId":"1","text":"I","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":34},{"id":"36","categoryId":"1","text":"Me","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":35},{"id":"37","categoryId":"1","text":"Finished","symbol":"all_done","photoId":null,"isFavorite":false,"sortOrder":36},{"id":"38","categoryId":"2","text":"Please","symbol":"want","photoId":null,"isFavorite":false,"sortOrder":0},{"id":"39","categoryId":"2","text":"Thank you","symbol":"love","photoId":null,"isFavorite":true,"sortOrder":1},{"id":"40","categoryId":"2","text":"Hello","symbol":"hello","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"41","categoryId":"2","text":"Goodbye","symbol":"goodbye","photoId":null,"isFavorite":false,"sortOrder":3},{"id":"42","categoryId":"3","text":"I am happy","symbol":"happy","photoId":null,"isFavorite":false,"sortOrder":0},{"id":"43","categoryId":"3","text":"I am sad","symbol":"sad","photoId":null,"isFavorite":false,"sortOrder":1},{"id":"44","categoryId":"3","text":"I am tired","symbol":"tired","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"45","categoryId":"3","text":"I am scared","symbol":"scared","photoId":null,"isFavorite":false,"sortOrder":3},{"id":"46","categoryId":"3","text":"I love you","symbol":"love","photoId":null,"isFavorite":true,"sortOrder":4},{"id":"47","categoryId":"3","text":"I need a break","symbol":"rest","photoId":null,"isFavorite":false,"sortOrder":5},{"id":"48","categoryId":"4","text":"I am hungry","symbol":"eat","photoId":null,"isFavorite":true,"sortOrder":0},{"id":"49","categoryId":"4","text":"I am thirsty","symbol":"drink","photoId":null,"isFavorite":true,"sortOrder":1},{"id":"50","categoryId":"4","text":"I need the bathroom","symbol":"bathroom","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"51","categoryId":"4","text":"I need help","symbol":"help","photoId":null,"isFavorite":true,"sortOrder":3},{"id":"52","categoryId":"4","text":"I am in pain","symbol":"doctor","photoId":null,"isFavorite":false,"sortOrder":4},{"id":"53","categoryId":"4","text":"I want to rest","symbol":"rest","photoId":null,"isFavorite":false,"sortOrder":5},{"id":"54","categoryId":"5","text":"Water, please","symbol":"drink","photoId":null,"isFavorite":false,"sortOrder":0},{"id":"55","categoryId":"5","text":"More, please","symbol":"more","photoId":null,"isFavorite":false,"sortOrder":1},{"id":"56","categoryId":"5","text":"All done","symbol":"all_done","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"57","categoryId":"5","text":"I like this","symbol":"like","photoId":null,"isFavorite":false,"sortOrder":3},{"id":"58","categoryId":"5","text":"I do not like this","symbol":"dislike","photoId":null,"isFavorite":false,"sortOrder":4},{"id":"59","categoryId":"6","text":"Mom","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":0},{"id":"60","categoryId":"6","text":"Dad","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":1},{"id":"61","categoryId":"6","text":"Friend","symbol":"person","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"62","categoryId":"6","text":"Teacher","symbol":"school","photoId":null,"isFavorite":false,"sortOrder":3},{"id":"63","categoryId":"6","text":"Doctor","symbol":"doctor","photoId":null,"isFavorite":false,"sortOrder":4},{"id":"64","categoryId":"7","text":"I want to play","symbol":"play","photoId":null,"isFavorite":false,"sortOrder":0},{"id":"65","categoryId":"7","text":"Read a book","symbol":"book","photoId":null,"isFavorite":false,"sortOrder":1},{"id":"66","categoryId":"7","text":"Watch a show","symbol":"tv","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"67","categoryId":"7","text":"Go outside","symbol":"outside","photoId":null,"isFavorite":false,"sortOrder":3},{"id":"68","categoryId":"7","text":"Listen to music","symbol":"music","photoId":null,"isFavorite":false,"sortOrder":4},{"id":"69","categoryId":"8","text":"School","symbol":"school","photoId":null,"isFavorite":false,"sortOrder":0},{"id":"70","categoryId":"8","text":"Class","symbol":"people","photoId":null,"isFavorite":false,"sortOrder":1},{"id":"71","categoryId":"8","text":"Teacher","symbol":"school","photoId":null,"isFavorite":false,"sortOrder":2},{"id":"72","categoryId":"8","text":"Read","symbol":"book","photoId":null,"isFavorite":false,"sortOrder":3},{"id":"73","categoryId":"8","text":"Write","symbol":"write","photoId":null,"isFavorite":false,"sortOrder":4},{"id":"74","categoryId":"8","text":"Draw","symbol":"draw","photoId":null,"isFavorite":false,"sortOrder":5},{"id":"75","categoryId":"8","text":"Book","symbol":"book","photoId":null,"isFavorite":false,"sortOrder":6},{"id":"76","categoryId":"8","text":"Pencil","symbol":"write","photoId":null,"isFavorite":false,"sortOrder":7},{"id":"77","categoryId":"8","text":"Paper","symbol":"write","photoId":null,"isFavorite":false,"sortOrder":8},{"id":"78","categoryId":"8","text":"Backpack","symbol":"backpack","photoId":null,"isFavorite":false,"sortOrder":9},{"id":"79","categoryId":"8","text":"Lunch","symbol":"lunch","photoId":null,"isFavorite":false,"sortOrder":10},{"id":"80","categoryId":"8","text":"Recess","symbol":"outside","photoId":null,"isFavorite":false,"sortOrder":11},{"id":"81","categoryId":"8","text":"Bathroom","symbol":"bathroom","photoId":null,"isFavorite":false,"sortOrder":12},{"id":"82","categoryId":"8","text":"Help","symbol":"help","photoId":null,"isFavorite":false,"sortOrder":13},{"id":"83","categoryId":"8","text":"Finished","symbol":"all_done","photoId":null,"isFavorite":false,"sortOrder":14}]}$seed$::jsonb; $seedfn$;
revoke all on function connectus_private.seed() from public,anon,authenticated;
