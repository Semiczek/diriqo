import 'server-only'

// Every save goes through one authenticated transaction; there is no split-write fallback.
export {
  createCoreCalculation as createCalculation,
  updateCoreCalculation as updateCalculation,
} from '@/lib/dal/core-calculation-save'
