"use client";

import styles from "@/styles/RecruitPopup.module.css";
import { FaArrowRight } from "react-icons/fa";
import DefaultBtn from "./DefaultBtn";
import { useRouter } from "next/navigation";
import { IoClose } from "react-icons/io5";
import { TbInfoHexagonFilled } from "react-icons/tb";
import type { PublicRecruitmentSettings } from "@/lib/public-recruitment";

interface RecruitPopupProps {
  visible: boolean;
  onClose: () => void;
  settings: PublicRecruitmentSettings | null;
}

export default function RecruitPopup({ visible, onClose, settings }: RecruitPopupProps) {
  const router = useRouter();

  if (!visible || !settings) {
    return null;
  }

  const go = () => {
    if (settings.button_href.startsWith("/")) router.push(settings.button_href);
    else window.location.href = settings.button_href;
  };

  return (
    <div className={styles.popup_backdrop} onClick={onClose}>
      <div className={styles.popup_window} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className={styles.popup_close_btn}>
          <IoClose />
        </button>
        <div className={styles.popup_content}>
          <p className={styles.popup_title}>
            <TbInfoHexagonFilled /> {settings.title}
          </p>
          <p className={styles.popup_description}>
            {settings.description}
          </p>

          <DefaultBtn onClick={go} style={{ marginTop: "30px", width: "100%" }}>
            {settings.button_label} <FaArrowRight />
          </DefaultBtn>
        </div>
      </div>
    </div>
  );
}
