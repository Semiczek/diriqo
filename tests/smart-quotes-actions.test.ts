import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}))
vi.mock('@/lib/dal/auth',()=>({requireCompanyRoleDalContext:mocks.context}))
vi.mock('@/lib/supabase-server',()=>({createSupabaseServerClient:async()=>({rpc:mocks.rpc})}))

import { runQuoteCommand } from '../app/smart-quotes/actions'
import { respondToQuote } from '../app/quote/[token]/actions'

beforeEach(()=>{
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({companyId:'company-current',supabase:{rpc:mocks.rpc}})
  mocks.rpc.mockResolvedValue({data:{id:'record'},error:null})
})
describe('smart quote server actions',()=>{
  it('rejects stale-company forms before any business RPC',async()=>{
    const result=await runQuoteCommand('company-before-switch','publish',{id:'quote',revision:1})
    expect(result).toMatchObject({ok:false,error:expect.stringMatching(/firma se změnila/)})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('authenticates all commands and passes trusted active tenant as RPC authority',async()=>{
    await runQuoteCommand('company-current','publish',{id:'quote',revision:2,companyId:'forged-tenant'})
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith('super_admin','company_admin','manager')
    expect(mocks.rpc).toHaveBeenCalledWith('smart_quotes_command',expect.objectContaining({target_company_id:'company-current',command:'publish'}))
  })
  it('fails closed on revoked entitlement and does not revalidate as success',async()=>{
    mocks.rpc.mockResolvedValue({error:{message:'MODULE_REQUIRED'},data:null})
    expect(await runQuoteCommand('company-current','convert',{id:'quote'})).toMatchObject({ok:false})
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('rejects invalid manual drafts without reaching the DB',async()=>{
    expect(await runQuoteCommand('company-current','save',{draft:{variants:[]}})).toMatchObject({ok:false})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects malformed bearer tokens before DB access',async()=>{
    expect(await respondToQuote('too-short',1,new FormData())).toMatchObject({ok:false})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('binds the public decision to a specific token, version, variant and explicit consent',async()=>{
    const form=new FormData();form.set('name','Test User');form.set('email','test@example.test');form.set('variant','premium');form.set('decision','accept');form.set('consent','on')
    expect(await respondToQuote('a'.repeat(64),2,form)).toEqual({ok:true})
    expect(mocks.rpc).toHaveBeenCalledWith('smart_quote_public_respond',{access_token:'a'.repeat(64),target_version:2,variant_id:'premium',customer_name:'Test User',customer_email:'test@example.test',decision:'accept',consent:true})
  })
})
