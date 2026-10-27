import { useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Floor from "./pages/Floor";
import Pos from "./pages/Pos";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Billing from "./pages/Billing";
import BillDetail from "./pages/BillDetail";
import MenuManager from "./pages/MenuManager";
import Analytics from "./pages/Analytics";
import SqlLab from "./pages/SqlLab";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="not-found">
      <span className="not-found__icon">
        <Compass size={26} />
      </span>
      <p className="eyebrow">404</p>
      <h1>That table isn’t in the room.</h1>
      <p>The page you’re looking for has moved or never existed.</p>
      <Link to="/" className="btn btn--primary">
        Back to dashboard
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="floor" element={<Floor />} />
          <Route path="pos" element={<Pos />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:orderId" element={<OrderDetail />} />
          <Route path="billing" element={<Billing />} />
          <Route path="bills/:billId" element={<BillDetail />} />
          <Route path="menu" element={<MenuManager />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="sql" element={<SqlLab />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
