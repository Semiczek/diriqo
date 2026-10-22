-- Transport context may change when a customer retries the same pending response.
-- Keep visitor identity and every business field in the exact idempotency comparison.
-- Replay returns the original receipt without rewriting the first captured metadata.
create or replace function private.respond_public_core_quote_version(input_token text,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare t private.core_quote_tokens%rowtype; q public.quotes%rowtype; r private.core_quote_responses%rowtype; result jsonb; scope text; response_id uuid; x text;
begin
 if p_operation_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in('version_id','action_type','customer_name','customer_email','customer_phone','note','visitor_id','user_agent','referrer'))
  or p_input->>'action_type' is null or p_input->>'action_type' not in('interested','contact_requested','revision_requested','not_interested') then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023'; end if;
 foreach x in array array['customer_name','customer_email','customer_phone','visitor_id','user_agent','referrer'] loop
  perform private.core_calculation_text(coalesce(p_input->x,'null'),case when x='referrer' then 2000 when x='user_agent' then 1000 else 320 end);
 end loop;
 perform private.core_calculation_text(coalesce(p_input->'note','null'),10000);
 -- Resolve without a row lock, then take the same company -> quote -> token order
 -- as authenticated revocation; no token-lock/company-lock inversion.
 select * into t from private.core_quote_tokens where token=input_token and not legacy;
 if not found or t.version_id::text is distinct from p_input->>'version_id' then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 perform 1 from public.companies where id=t.company_id for update;
 select * into q from public.quotes where company_id=t.company_id and id=t.quote_id for update;
 if not found or q.archived_at is not null then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
 select * into t from private.core_quote_tokens where token=input_token and revoked_at is null and(expires_at is null or expires_at>clock_timestamp()) for share;
 if not found or(t.expires_at is not null and t.expires_at<=clock_timestamp()) then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
 scope:='public:'||private.core_quote_hash(to_jsonb(input_token));
 select * into r from private.core_quote_responses where actor_scope=scope and operation_id=p_operation_id;
 if found then
  if (r.payload-array['user_agent','referrer'])<>(p_input-array['user_agent','referrer']) or r.version_id<>t.version_id then raise exception 'CORE_QUOTE_OPERATION_CONFLICT' using errcode='PT409'; end if;
  return r.result||jsonb_build_object('replayed',true);
 end if;
 if exists(select 1 from private.core_quote_versions v where v.id=t.version_id and nullif(v.document->>'valid_until','')::date<current_date) then raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409'; end if;
 response_id:=gen_random_uuid();
 result:=jsonb_build_object('success',true,'quoteId',t.quote_id,'versionId',t.version_id,'operationId',p_operation_id,'responseId',response_id,'replayed',false);
 insert into private.core_quote_responses(company_id,quote_id,version_id,operation_id,actor_scope,payload,result) values(t.company_id,t.quote_id,t.version_id,p_operation_id,scope,p_input,result);
 -- Interest/request is an event only. It never changes acceptance or issued content.
 return result;
exception when invalid_parameter_value then if sqlerrm like 'CALCULATION_%' then raise exception 'CORE_QUOTE_INVALID_INPUT' using errcode='22023';end if;raise;
end;
$f$;
revoke all on function private.respond_public_core_quote_version(text,uuid,jsonb) from public,anon,authenticated,service_role;
