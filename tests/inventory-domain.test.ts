import { describe,it,expect } from 'vitest'
import { decimalToMinor,quantityValue,validateInventoryCommand } from '../lib/inventory/domain'
describe('inventory exact input boundaries',()=>{
 it('parses money without floating rounding',()=>{expect(decimalToMinor('0,29')).toBe(29);expect(decimalToMinor('1299.99')).toBe(129999)})
 it('rejects hidden exponent, negative and fractional minor units',()=>{for(const v of ['1e3','-5','0.001','NaN','Infinity','999999999999'])expect(()=>decimalToMinor(v)).toThrow()})
 it('retains three decimal quantity places',()=>{expect(quantityValue('0,125')).toBe('0.125');expect(quantityValue('12')).toBe('12.000')})
 it('rejects repeated receipt lines',()=>{expect(()=>validateInventoryCommand('receive_order',{lines:[{line_id:'10000000-0000-4000-8000-000000000001',quantity:2},{line_id:'10000000-0000-4000-8000-000000000001',quantity:3}]},'20000000-0000-4000-8000-000000000002')).toThrow()})
 it('rejects malformed request identity and unknown command',()=>{expect(()=>validateInventoryCommand('post',{},'bad')).toThrow();expect(()=>validateInventoryCommand('delete_all',{},'20000000-0000-4000-8000-000000000002')).toThrow()})
})
