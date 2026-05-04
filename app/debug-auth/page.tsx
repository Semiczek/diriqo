'use client'

import { useEffect, useState } from 'react'
import DashboardShell from '../../components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '../../lib/supabase'

export default function DebugAuthPage() {
  const { dictionary } = useI18n()
  const t = dictionary.debugAuth
  const [output, setOutput] = useState<string>(t.loading)

  useEffect(() => {
    async function run() {
      try {
        const sessionResult = await supabase.auth.getSession()
        const userResult = await supabase.auth.getUser()

        const jobsResponse = await supabase
          .from('jobs')
          .select('id, title, company_id')
          .limit(5)

        const assignmentsResponse = await supabase
          .from('job_assignments')
          .select('job_id, profile_id')
          .limit(5)

        const workShiftsResponse = await supabase
          .from('work_shifts')
          .select('id, profile_id, company_id')
          .limit(5)

        const text = JSON.stringify(
          {
            sessionResult,
            userResult,
            jobsResponse,
            assignmentsResponse,
            workShiftsResponse,
          },
          null,
          2
        )

        console.log('DEBUG AUTH PAGE', {
          sessionResult,
          userResult,
          jobsResponse,
          assignmentsResponse,
          workShiftsResponse,
        })

        setOutput(text)
      } catch (error) {
        console.error('DEBUG AUTH PAGE ERROR', error)

        setOutput(
          JSON.stringify(
            {
              error:
                error instanceof Error ? error.message : t.unknownError,
            },
            null,
            2
          )
        )
      }
    }

    run()
  }, [t.unknownError])

  return (
    <DashboardShell activeItem="jobs">
      <main
        style={{
          maxWidth: '1100px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <h1 style={{ fontSize: '40px', marginBottom: '20px' }}>{t.title}</h1>

        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '16px',
            fontSize: '13px',
            lineHeight: '1.5',
          }}
        >
          {output}
        </pre>
      </main>
    </DashboardShell>
  )
}


