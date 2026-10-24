import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({context:vi.fn(),list:vi.fn(),sources:vi.fn(),shell:vi.fn(),client:vi.fn()}))
vi.mock('@/lib/dal/auth',()=>({requireCompanyRoleDalContext:mocks.context}))
vi.mock('@/lib/dal/labor-history',()=>({listLaborSubmissions:mocks.list,listLaborSourceOptions:mocks.sources}))
vi.mock('@/components/DashboardShell',()=>({default:mocks.shell}))
vi.mock('@/components/LanguageSwitcher',()=>({default:()=>null}))
vi.mock('@/app/labor/LaborWorkspaceClient',()=>({default:mocks.client}))
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=>createElement('a',{href},children)}))
import LaborPage from '../app/labor/page'
const companyId='11111111-1111-4111-8111-111111111111',profileId='22222222-2222-4222-8222-222222222222',jobId='33333333-3333-4333-8333-333333333333'
beforeEach(()=>{vi.resetAllMocks();mocks.context.mockResolvedValue({companyId,profileId,role:'worker'});mocks.list.mockResolvedValue({companyId,items:[]});mocks.sources.mockResolvedValue({companyId,companyName:'Firm',items:[]});mocks.client.mockReturnValue(createElement('p',null,'workspace'));mocks.shell.mockImplementation(({children}:{children:React.ReactNode})=>createElement('div',null,children))})
describe('Labor server page role and query boundary',()=>{
 it('uses the member shell for workers',async()=>{const html=renderToStaticMarkup(await LaborPage({searchParams:Promise.resolve({})}));expect(html).toContain('/mobile/my');expect(mocks.shell).not.toHaveBeenCalled()})
 it('uses the manager member shell without AdminAuthGuard',async()=>{mocks.context.mockResolvedValue({companyId,profileId,role:'manager'});const html=renderToStaticMarkup(await LaborPage({searchParams:Promise.resolve({})}));expect(html).toContain('/mobile/manager');expect(mocks.shell).not.toHaveBeenCalled()})
 it('uses the labor navigation in the admin shell',async()=>{mocks.context.mockResolvedValue({companyId,profileId,role:'company_admin'});renderToStaticMarkup(await LaborPage({searchParams:Promise.resolve({})}));expect(mocks.shell.mock.calls[0][0].activeItem).toBe('labor')})
 it('validates and forwards company-scoped job and worker filters',async()=>{renderToStaticMarkup(await LaborPage({searchParams:Promise.resolve({job:jobId,worker:profileId})}));expect(mocks.list.mock.calls[0][1]).toEqual({jobId,profileId});expect(mocks.sources.mock.calls[0][1]).toEqual({profileId})})
 it('does not query or render data for invalid query identifiers',async()=>{const html=renderToStaticMarkup(await LaborPage({searchParams:Promise.resolve({job:['invalid']})}));expect(mocks.list).not.toHaveBeenCalled();expect(mocks.client).not.toHaveBeenCalled();expect(html).toContain('Timesheets unavailable')})
 it('does not render partially loaded data if source authorization fails',async()=>{mocks.sources.mockRejectedValue(Error('denied'));renderToStaticMarkup(await LaborPage({searchParams:Promise.resolve({})}));expect(mocks.client).not.toHaveBeenCalled()})
})
