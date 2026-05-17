import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { LogsModal } from './logs-modal'
import { ArrowDownToLine, SquarePen, BarChart3, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'

export function ScopeBar() {
  const {
    selectedProjectId,
    selectedSessionId,
    autoFollow,
    setAutoFollow,
    expandedEventIds,
    collapseAllEvents,
    requestExpandAll,
    setEditingSessionId,
    dedupEnabled,
    openSettings,
  } = useUIStore()

  if (!selectedProjectId || !selectedSessionId) return null

  return (
    <div className="flex items-center ml-auto shrink-0">
      <div className="flex items-center gap-1 shrink-0">
        {/* Follow */}
        <Button
          variant={autoFollow ? 'default' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setAutoFollow(!autoFollow)}
          title={autoFollow ? 'Auto-follow enabled' : 'Auto-follow disabled'}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </Button>
        {/* Expand/Collapse */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            if (expandedEventIds.size > 0) {
              collapseAllEvents()
            } else {
              requestExpandAll()
            }
          }}
          title={expandedEventIds.size > 0 ? 'Collapse all' : 'Expand all'}
        >
          {expandedEventIds.size > 0 ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </Button>
        {/* Logs */}
        <LogsModal />
        {/* Stats */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setEditingSessionId(selectedSessionId, 'stats')}
          title="Session stats"
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </Button>
        {/* Edit */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setEditingSessionId(selectedSessionId)}
          title="Edit session"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
        {/* Dedup toggle */}
        <button
          className={`rounded-full px-2 py-0.5 text-2xs border cursor-pointer transition-colors shrink-0 ml-1 ${
            dedupEnabled
              ? 'border-border/50 text-muted-foreground/50 hover:border-border hover:text-muted-foreground'
              : 'border-orange-500/50 text-orange-500 hover:border-orange-500 hover:text-orange-600'
          }`}
          onClick={() => openSettings('settings')}
          title={dedupEnabled ? 'Event dedup is on' : 'Event dedup is off — showing raw events'}
        >
          {dedupEnabled ? 'Dedup Events' : 'Raw Events'}
        </button>
      </div>
    </div>
  )
}
