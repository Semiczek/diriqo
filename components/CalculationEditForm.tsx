'use client'

import CalculationCreateForm, { type CalculationFormInitialValues } from './CalculationCreateForm'

export type CalculationEditFormProps = {
  companyId: string
  profileId: string
  calculationId: string
  expectedRevision: string
  customerId?: string | null
  cancelHref: string
  detailHref: string
  initialValues: CalculationFormInitialValues
}

export default function CalculationEditForm(props: CalculationEditFormProps) {
  return <CalculationCreateForm {...props} customerName="" edit={{ calculationId: props.calculationId,
    expectedRevision: props.expectedRevision, detailHref: props.detailHref, initialValues: props.initialValues }} />
}
