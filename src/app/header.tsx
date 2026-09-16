"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ui_styles from "@/styles/ui.module.css";

import DefaultBtn from "@/component/DefaultBtn";
import { FaArrowRight } from "react-icons/fa";
import { IoIosMenu, IoMdClose } from "react-icons/io";
import { withBasePath } from "@/lib/base-path";

import { useRouter, usePathname } from "next/navigation";


export default function Header() {
    const [lastScrollY, setLastScrollY] = useState(0);
    const [hideHeader, setHideHeader] = useState(false);
    const [atTop, setAtTop] = useState(true);
    const [showMenu, setShowMenu] = useState(false);

    const router = useRouter();
    const pathname = usePathname();

    

    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            setHideHeader(currentScrollY > lastScrollY && currentScrollY > 75);
            setAtTop(currentScrollY <= 10);
            setLastScrollY(currentScrollY);
        };

        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, [lastScrollY]);

    function openMenu() {
        setShowMenu(true);
    }

    function closeMenu() {
        setShowMenu(false);
    }



    return (<>

        <header
            className={ui_styles.header}
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
                transition: "transform 0.3s ease, background-color 0.3s ease",
                transform: hideHeader ? "translateY(-100%)" : "translateY(0)",
                backgroundColor: lastScrollY < 10 ? "rgba(0,0,0,0.0)" : "rgba(0,0,0,0.9)",
                backdropFilter : "blur(5px)"
            }}
        >
            <div className={ui_styles.header_wrap}>
                <div className={ui_styles.header_menu_wrap}>
                    <div className={ui_styles.header_left}>
                        <Link className={ui_styles.logo} href={"/"}>

                            <Image src={withBasePath("/ASC.png")} width={100} height={100} alt="logo" />
                            <span className={ui_styles.logo_text} style={{ fontWeight: 600, letterSpacing: -0.8, color: "rgba(255, 255, 255, 1)", }}>ASC</span>

                        </Link>




                        <div className={ui_styles.menus} style={{ color: "rgba(255, 255, 255, 0.8)" }}>
                            <div className={ui_styles.menu}><Link href={"/"}>Home</Link></div>
                            <div className={ui_styles.menu}><Link href={"/hall-of-fame"}>Hall of Fame</Link></div>
                            <div className={ui_styles.menu}><Link href={"https://ssu-asc.github.io/blog"}>Blog</Link></div>
                            <div className={ui_styles.menu}><Link href={"/qna"}>Q&A</Link></div>
                            <div className={ui_styles.menu}><Link href={"/member"}>Member</Link></div>
                        </div>
                    </div>
                    <div className={ui_styles.header_right}>
                        <div className={ui_styles.mobile_hide}>
                            <DefaultBtn
                                onClick={() => { router.push("/apply") }}
                                style={{ fontSize: "15px", padding: "10px 25px" }}
                            >
                                Apply Us <FaArrowRight />
                            </DefaultBtn>
                        </div>

                        <div className={ui_styles.mobile_show} onClick={() => { openMenu() }} >
                            <IoIosMenu style={{ fontSize: "30px", color: "white" }} />
                        </div>

                    </div>
                </div>
            </div>

            <div className={ui_styles.mobile_show}>

                <div className={ui_styles.mobile_menu_wrap} style={{ zIndex: 9999, transform: showMenu ? "translateY(0)" : "translateY(-100%)" }}>
                    <div className={ui_styles.close_btn} onClick={() => { closeMenu() }}><IoMdClose /></div>
                    <div className={ui_styles.mobile_menu}>
                        <div className={ui_styles.menu_btn}><Link href={"/"} onClick={() => { closeMenu() }}>Home</Link></div>
                        <div className={ui_styles.menu_btn}><Link href={"/hall-of-fame"} onClick={() => { closeMenu() }}>Hall of Fame</Link></div>
                        <div className={ui_styles.menu_btn}><Link href={"https://ssu-asc.github.io/blog"} onClick={() => { closeMenu() }}>Blog</Link></div>


                        <div className={ui_styles.menu_btn}><Link href={"/qna"} onClick={() => { closeMenu() }}>Q&A</Link></div>
                        <div className={ui_styles.menu_btn}><Link href={"/member"} onClick={() => { closeMenu() }}>Member</Link></div>


                        <DefaultBtn
                            onClick={() => { router.push("/apply"); closeMenu() }}
                            style={{ fontSize: "15px", padding: "10px 25px", marginTop: "50px", width: "100%" }}>
                            Apply Us <FaArrowRight />
                        </DefaultBtn>
                    </div>

                </div>

            </div>




        </header>
    </>

    );
}
