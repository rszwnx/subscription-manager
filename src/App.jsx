import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import Chart from 'chart.js/auto';

const deptColors = ['#4a46b8', '#1f7a9c', '#2d7d46', '#c0763a', '#8a5c00', '#a04a8f'];

function fmt(v) {
  return v.toLocaleString('ko-KR') + '원';
}

function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return `${y}년 ${mo}월`;
}

export default function App() {
  const [allSubs, setAllSubs] = useState([]);
  const [months, setMonths] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('desc');
  const [toast, setToast] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', sub: '', amt: '', dept: '', members: '', status: 'active' });
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  const fetchSubs = useCallback(async () => {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .order('id', { ascending: true });
    if (error) {
      showToast('데이터 불러오기 실패');
      console.error(error);
      setLoading(false);
      return;
    }
    const rows = data || [];
    setAllSubs(rows);
    const uniqueMonths = [...new Set(rows.map((r) => r.month))].sort();
    setMonths(uniqueMonths);
    setCurrentMonth((prev) => {
      if (prev && uniqueMonths.includes(prev)) return prev;
      return uniqueMonths[uniqueMonths.length - 1] || null;
    });
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    fetchSubs();
    const channel = supabase
      .channel('subscriptions-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => {
        fetchSubs();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchSubs]);

  const subs = currentMonth ? allSubs.filter((s) => s.month === currentMonth) : [];
  const isLatestMonth = currentMonth === months[months.length - 1];

  useEffect(() => {
    if (!chartRef.current) return;
    const activeSubs = subs.filter((s) => s.status === 'active');
    const deptMap = {};
    activeSubs.forEach((s) => { deptMap[s.dept] = (deptMap[s.dept] || 0) + s.amt; });
    const labels = Object.keys(deptMap).sort((a, b) => deptMap[b] - deptMap[a]);
    const data = labels.map((l) => deptMap[l]);
    const colors = labels.map((_, i) => deptColors[i % deptColors.length]);

    if (chartInstance.current) chartInstance.current.destroy();
    chartInstance.current = new Chart(chartRef.current, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: false,
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ' ' + ctx.label + ': ' + fmt(ctx.raw) } },
        },
      },
    });
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [subs]);

  const activeSubs = subs.filter((s) => s.status === 'active');
  const cancelCount = subs.filter((s) => s.status === 'cancel').length;
  const total = activeSubs.reduce((a, b) => a + b.amt, 0);

  const deptMap = {};
  activeSubs.forEach((s) => { deptMap[s.dept] = (deptMap[s.dept] || 0) + s.amt; });
  const deptLabels = Object.keys(deptMap).sort((a, b) => deptMap[b] - deptMap[a]);

  const filtered = filter === 'all' ? subs : subs.filter((s) => s.status === filter);
  const sorted = [...filtered].sort((a, b) => (sort === 'desc' ? b.amt - a.amt : a.amt - b.amt));

  async function updateAmount(id, newAmt) {
    const { error } = await supabase.from('subscriptions').update({ amt: newAmt }).eq('id', id);
    if (error) { showToast('저장 실패'); }
    else { setAllSubs((prev) => prev.map((s) => (s.id === id ? { ...s, amt: newAmt } : s))); }
  }

  async function updateNote(id, newNote) {
    const { error } = await supabase.from('subscriptions').update({ note: newNote }).eq('id', id);
    if (error) { showToast('저장 실패'); }
    else { setAllSubs((prev) => prev.map((s) => (s.id === id ? { ...s, note: newNote } : s))); }
  }

  async function toggleStatus(s) {
    const newStatus = s.status === 'active' ? 'cancel' : 'active';
    const { error } = await supabase.from('subscriptions').update({ status: newStatus }).eq('id', s.id);
    if (error) { showToast('변경 실패'); }
    else {
      setAllSubs((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: newStatus } : x)));
      showToast(newStatus === 'active' ? `${s.name} 활성으로 변경됨` : `${s.name} 해지로 변경됨`);
    }
  }

  function openAddModal() {
    setEditingId(null);
    setForm({ name: '', sub: '', amt: '', dept: '', members: '', status: 'active' });
    setModalOpen(true);
  }

  function openEditModal(s) {
    setEditingId(s.id);
    setForm({
      name: s.name, sub: s.sub || '', amt: String(s.amt), dept: s.dept,
      members: (s.members || []).join(', '), status: s.status,
    });
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); }

  async function saveModal() {
    const name = form.name.trim();
    if (!name) { showToast('서비스명을 입력해주세요'); return; }
    const amt = parseInt(String(form.amt).replace(/[^0-9]/g, '')) || 0;
    const dept = form.dept.trim() || '미지정';
    const members = form.members.trim() ? form.members.split(',').map((m) => m.trim()).filter(Boolean) : [];
    const payload = { name, sub: form.sub.trim(), amt, dept, members, status: form.status };

    if (editingId) {
      const { error } = await supabase.from('subscriptions').update(payload).eq('id', editingId);
      if (error) { showToast('수정 실패'); }
      else {
        setAllSubs((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...payload } : s)));
        showToast(`${name} 수정 완료`);
      }
    } else {
      const { data, error } = await supabase.from('subscriptions').insert({ ...payload, month: currentMonth }).select();
      if (error) { showToast('추가 실패'); }
      else if (data) {
        setAllSubs((prev) => [...prev, ...data]);
        showToast(`${name} 구독이 추가되었습니다`);
      }
    }
    setModalOpen(false);
  }

  async function deleteSub() {
    if (!editingId) return;
    const s = allSubs.find((x) => x.id === editingId);
    if (!s) return;
    if (!window.confirm(`'${s.name}' 구독을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    const { error } = await supabase.from('subscriptions').delete().eq('id', editingId);
    if (error) { showToast('삭제 실패'); }
    else {
      setAllSubs((prev) => prev.filter((x) => x.id !== editingId));
      showToast(`${s.name} 삭제됨`);
    }
    setModalOpen(false);
  }

  async function saveSnapshot() {
    if (!currentMonth) return;
    const newMonth = nextMonth(currentMonth);
    if (months.includes(newMonth)) {
      showToast(`${monthLabel(newMonth)}은 이미 존재해요`);
      return;
    }
    if (!window.confirm(`${monthLabel(currentMonth)} 현황을 그대로 복사해서 ${monthLabel(newMonth)}을 새로 만들까요?`)) return;

    const currentRows = allSubs.filter((s) => s.month === currentMonth);
    const newRows = currentRows.map(({ id, created_at, updated_at, ...rest }) => ({ ...rest, month: newMonth }));

    const { data, error } = await supabase.from('subscriptions').insert(newRows).select();
    if (error) {
      showToast('스냅샷 저장 실패');
      console.error(error);
    } else {
      setAllSubs((prev) => [...prev, ...(data || [])]);
      setMonths((prev) => [...prev, newMonth].sort());
      setCurrentMonth(newMonth);
      showToast(`${monthLabel(newMonth)} 스냅샷이 저장되었습니다`);
    }
  }

  return (
    <>
      <header>
        <div className="logo">
          <div className="logo-dot"></div>
          유쾌한프로젝트 구독 관리
        </div>
        <div className="sync-status">
          <div className="sync-dot"></div>
          실시간 동기화
        </div>
      </header>

      <main>
        <div className="page-title-row">
          <div>
            <div className="page-title">법인카드 구독 현황</div>
            <div className="page-sub">카드번호 4201-****-****-9645 · 모든 변경사항은 자동으로 저장되고 실시간으로 공유됩니다</div>
          </div>
          <div className="month-controls">
            {months.length > 0 && (
              <select className="month-select" value={currentMonth || ''} onChange={(e) => setCurrentMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            )}
            {isLatestMonth && currentMonth && (
              <button className="btn btn-snapshot" onClick={saveSnapshot}>
                {monthLabel(nextMonth(currentMonth))} 스냅샷 저장
              </button>
            )}
          </div>
        </div>

        <div className="top-row">
          <div className="metrics">
            <div className="metric">
              <div className="metric-label">활성 구독</div>
              <div className="metric-value">{activeSubs.length}개</div>
              <div className="metric-sub">해지 {cancelCount}건 제외</div>
            </div>
            <div className="metric">
              <div className="metric-label">월 예상 지출</div>
              <div className="metric-value">{Math.round(total / 10000)}만원</div>
              <div className="metric-sub">{fmt(total)}</div>
            </div>
          </div>
          <div className="dept-card">
            <div className="dept-card-title">부서별 지출 비율</div>
            <div className="dept-chart-wrap">
              <canvas ref={chartRef} width="108" height="108"></canvas>
              <div className="dept-legend">
                {deptLabels.map((l, i) => (
                  <div className="dept-legend-item" key={l}>
                    <div className="dept-legend-left">
                      <div className="dept-dot" style={{ background: deptColors[i % deptColors.length] }}></div>
                      <span>{l}</span>
                    </div>
                    <span className="dept-legend-amt">{fmt(deptMap[l])}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <div className="filter-bar-left">
            <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>전체</button>
            <button className={`filter-btn ${filter === 'active' ? 'active' : ''}`} onClick={() => setFilter('active')}>활성</button>
            <button className={`filter-btn ${filter === 'cancel' ? 'active' : ''}`} onClick={() => setFilter('cancel')}>해지</button>
          </div>
          <div className="filter-bar-right">
            <div className="sort-group">
              <span className="sort-label">정렬</span>
              <button className={`sort-btn ${sort === 'desc' ? 'active' : ''}`} onClick={() => setSort('desc')}>비용 높은순</button>
              <button className={`sort-btn ${sort === 'asc' ? 'active' : ''}`} onClick={() => setSort('asc')}>비용 낮은순</button>
            </div>
            <button className="btn btn-primary" onClick={openAddModal}>+ 구독 추가</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <colgroup>
              <col className="c-no" /><col className="c-name" /><col className="c-amt" /><col className="c-cycle" />
              <col className="c-dept" /><col className="c-mem" /><col className="c-status" /><col className="c-note" /><col className="c-edit" />
            </colgroup>
            <thead>
              <tr>
                <th></th><th>서비스</th><th style={{ textAlign: 'right' }}>월 비용</th><th>주기</th>
                <th>부서</th><th>멤버</th><th>상태</th><th>비고</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9"><div className="loading-state">불러오는 중...</div></td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan="9"><div className="loading-state">표시할 구독이 없어요</div></td></tr>
              ) : (
                sorted.map((s, i) => (
                  <Row
                    key={s.id}
                    s={s}
                    index={i}
                    onAmtChange={updateAmount}
                    onNoteChange={updateNote}
                    onToggleStatus={toggleStatus}
                    onEdit={openEditModal}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {modalOpen && (
        <div className="modal-overlay" onClick={(e) => { if (e.target.className === 'modal-overlay') closeModal(); }}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">{editingId ? '구독 수정' : '구독 추가'}</div>
              <button className="modal-close" onClick={closeModal}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>서비스명</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: Linear" autoFocus />
              </div>
              <div className="field">
                <label>설명 (작은 텍스트)</label>
                <input type="text" value={form.sub} onChange={(e) => setForm({ ...form, sub: e.target.value })} placeholder="예: 이슈 트래커" />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>월 비용</label>
                  <input type="text" inputMode="numeric" value={form.amt} onChange={(e) => setForm({ ...form, amt: e.target.value })} placeholder="0" />
                </div>
                <div className="field">
                  <label>부서</label>
                  <input type="text" value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} placeholder="예: 기술개발본부" />
                </div>
              </div>
              <div className="field">
                <label>멤버 (쉼표로 구분)</label>
                <input type="text" value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value })} placeholder="예: Clify, 오지수" />
              </div>
              <div className="field">
                <label>상태</label>
                <div className="status-toggle">
                  <button type="button" className={`status-toggle-btn ${form.status === 'active' ? 'active' : ''}`} onClick={() => setForm({ ...form, status: 'active' })}>활성</button>
                  <button type="button" className={`status-toggle-btn ${form.status === 'cancel' ? 'active' : ''}`} onClick={() => setForm({ ...form, status: 'cancel' })}>해지</button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {editingId && (
                <button className="btn" onClick={deleteSub} style={{ color: 'var(--red)', borderColor: 'var(--red-light)' }}>삭제</button>
              )}
              <div style={{ flex: 1 }}></div>
              <button className="btn" onClick={closeModal}>취소</button>
              <button className="btn btn-primary" onClick={saveModal}>저장</button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}

function Row({ s, index, onAmtChange, onNoteChange, onToggleStatus, onEdit }) {
  const [amtDraft, setAmtDraft] = useState(s.amt.toLocaleString('ko-KR'));
  const [noteDraft, setNoteDraft] = useState(s.note || '');
  const noteRef = useRef(null);

  useEffect(() => { setAmtDraft(s.amt.toLocaleString('ko-KR')); }, [s.amt]);
  useEffect(() => { setNoteDraft(s.note || ''); }, [s.note]);

  useEffect(() => {
    if (noteRef.current) {
      noteRef.current.style.height = 'auto';
      noteRef.current.style.height = noteRef.current.scrollHeight + 'px';
    }
  }, [noteDraft]);

  const badgeCls = s.status === 'active' ? 'badge-active' : 'badge-cancel';
  const badgeText = s.status === 'active' ? '활성' : '해지';

  return (
    <tr className={s.status === 'cancel' ? 'cancelled' : ''}>
      <td className="row-no">{index + 1}</td>
      <td>
        <div className="service-name">{s.name}</div>
        {s.sub && <div className="service-sub">{s.sub}</div>}
      </td>
      <td className="amount">
        <input
          className="amt-input"
          type="text"
          inputMode="numeric"
          value={amtDraft}
          disabled={s.status === 'cancel'}
          onChange={(e) => setAmtDraft(e.target.value)}
          onBlur={() => {
            const num = parseInt(amtDraft.replace(/[^0-9]/g, '')) || 0;
            setAmtDraft(num.toLocaleString('ko-KR'));
            if (num !== s.amt) onAmtChange(s.id, num);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        />
        <span className="amt-unit">원</span>
      </td>
      <td style={{ color: 'var(--text-muted)' }}>월</td>
      <td className="dept-tag">{s.dept}</td>
      <td>
        {s.members && s.members.length > 0 ? (
          <div className="chip-wrap">
            {s.members.map((m) => <span className="chip" key={m}>{m}</span>)}
          </div>
        ) : (
          <span className="dept-tag">—</span>
        )}
      </td>
      <td>
        <span className={`badge ${badgeCls}`} onClick={() => onToggleStatus(s)} style={{ cursor: 'pointer' }}>{badgeText}</span>
      </td>
      <td>
        <textarea
          ref={noteRef}
          className="note-input"
          rows="1"
          placeholder="비고 입력..."
          disabled={s.status === 'cancel'}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => { if (noteDraft !== (s.note || '')) onNoteChange(s.id, noteDraft); }}
        />
      </td>
      <td>
        <button className="edit-btn" onClick={() => onEdit(s)} title="수정" aria-label="수정">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5L13.5 4.5L5 13L2 14L3 11L11.5 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        </button>
      </td>
    </tr>
  );
}
