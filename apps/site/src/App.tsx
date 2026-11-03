import React from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home.js";
import Signup from "./pages/Signup.js";
import PrivacyPolicy from "./pages/PrivacyPolicy.js";
import TermsOfService from "./pages/TermsOfService.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/cadastro" element={<Signup />} />
      <Route path="/privacidade" element={<PrivacyPolicy />} />
      <Route path="/termos" element={<TermsOfService />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
