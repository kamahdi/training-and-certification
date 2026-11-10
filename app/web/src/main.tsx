import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { CheckInPage } from './patient/CheckInPage';
import { FormPage } from './patient/FormPage';
import { VisitPage } from './patient/VisitPage';
import { ManagerPage } from './staff/ManagerPage';
import { QueuePage } from './staff/QueuePage';
import { ReceptionPage } from './staff/ReceptionPage';
import { StaffHome } from './staff/StaffShell';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/v/:token" element={<VisitPage />} />
        <Route path="/f/:token" element={<FormPage />} />
        <Route path="/c" element={<CheckInPage />} />
        <Route path="/staff" element={<StaffHome />} />
        <Route path="/staff/queue" element={<QueuePage />} />
        <Route path="/staff/reception" element={<ReceptionPage />} />
        <Route path="/staff/manager" element={<ManagerPage />} />
        <Route path="*" element={<Navigate to="/staff" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
