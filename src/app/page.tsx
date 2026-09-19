"use client";

import Image from "next/image";
import styles from "@/styles/page.module.css";
import ui_styles from "@/styles/ui.module.css";

import ShowFullSizeVideo from "@/component/ShowFullSizeVideo";
import DefaultBtn from "@/component/DefaultBtn";
import FadeFromLeft from "@/component/FadeFromLeft";
import FadeFromRight from "@/component/FadeFromRight";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { FaArrowRight, FaBook } from "react-icons/fa";
import { LiaAngleDoubleDownSolid } from "react-icons/lia";
import { BsQuestionCircleFill } from "react-icons/bs";
import { FaEarthAsia, FaMemory } from "react-icons/fa6";
import { MdMemory } from "react-icons/md";
import { PiMathOperationsBold } from "react-icons/pi";

import { useRef, useEffect, useState } from "react";
import DefaultQA from "@/component/DefaultQA";
import DefaultAward from "@/component/DefaultAward";
import DefaultCurriculum from "@/component/DefaultCurriculum";
import { useRouter } from "next/navigation";
import RecruitPopup from "@/component/RecruitPopup";
import DefaultTeamActivity from "@/component/DefaultTeamActivity";
import { withBasePath } from "@/lib/base-path";
import { readPublicRecruitmentSettings, type PublicRecruitmentSettings } from "@/lib/member-api";
import { getMemberClient } from "@/lib/supabase";

gsap.registerPlugin(ScrollTrigger);

export default function Home() {

  const [awardList, setAwardList] = useState({} as any);
  const [activityList, setActivityList] = useState({} as any);
  const [curriculumList, setCurriculumList] = useState({} as any);
  const [recruitmentSettings, setRecruitmentSettings] = useState<PublicRecruitmentSettings | null>(null);
  const [projectData, setProjectData] = useState({} as any);
  const [showPopup, setShowPopup] = useState(false);
  const [showAllAwards, setShowAllAwards] = useState(false);
  const [openProjectYear, setOpenProjectYear] = useState<string | null>(null);

  const showCaseRef = useRef<HTMLDivElement>(null);
  const [activeCurriculum, setActiveCurriculum] = useState<string | null>("Web");

  const router = useRouter();

  const getDefaultProjectYear = (timeline: any[]) => {
    const sectionsWithProjects = timeline.filter(
      (section: any) => Array.isArray(section.projects) && section.projects.length > 0
    );
    const candidateSections = sectionsWithProjects.length > 0 ? sectionsWithProjects : timeline;

    return (
      candidateSections.reduce((latest: any, current: any) => {
        if (!latest) return current;

        const latestYear = Number.parseInt(String(latest.year ?? ""), 10);
        const currentYear = Number.parseInt(String(current.year ?? ""), 10);

        if (Number.isNaN(latestYear)) return current;
        if (Number.isNaN(currentYear)) return latest;

        return currentYear > latestYear ? current : latest;
      }, null)?.year ?? null
    );
  };

  useEffect(() => {

    fetch(withBasePath("/data/awards.json")).then(async (result) => {
      setAwardList(await result.json())
    })

    fetch(withBasePath("/data/activities.json")).then(async (result) => {
      setActivityList(await result.json())
    })

    fetch(withBasePath("/data/curriculums.json")).then(async (result) => {
      setCurriculumList(await result.json())
    })

    const publicClient = getMemberClient();
    if (publicClient) {
      void readPublicRecruitmentSettings(publicClient).then((settings) => {
        setRecruitmentSettings(settings);
        if (!settings?.enabled) return;
        const now = Date.now();
        const startsAt = settings.starts_at ? new Date(settings.starts_at).valueOf() : Number.NEGATIVE_INFINITY;
        const endsAt = settings.ends_at ? new Date(settings.ends_at).valueOf() : Number.POSITIVE_INFINITY;
        if (now >= startsAt && now <= endsAt) setShowPopup(true);
      }).catch(() => {
        // Public recruitment settings are optional. A read failure must never block the homepage.
      });
    }

    fetch(withBasePath("/data/projects.json")).then(async (result) => {
      const data = await result.json();
      setProjectData(data);
      setOpenProjectYear(getDefaultProjectYear(data.timeline ?? []));
    })

  }, [])

  const awardsToShow = awardList.awards ? (showAllAwards ? awardList.awards : awardList.awards.slice(0, 5)) : [];
  const projectTimeline = projectData.timeline ?? [];
  const selectedProjectYearSection =
    projectTimeline.find((section: any) => section.year === openProjectYear) ?? projectTimeline[0] ?? null;
  const selectedProjectList = selectedProjectYearSection?.projects ?? [];

  const toggleProjectYear = (year: string) => {
    setOpenProjectYear(year);
  };

  return (
    <div className={styles.page}>
        <RecruitPopup visible={showPopup} onClose={() => { setShowPopup(false) }} settings={recruitmentSettings} />
      <main className={styles.main}>

        <div className={styles.wrap} style={{ height: "100vh" }}>
          <ShowFullSizeVideo videoSrc="/dt.mp4"></ShowFullSizeVideo>
          <div className={styles.content}>
            <div
              className={`${ui_styles.text_title}`}
              style={{ "color": "white", fontWeight: 400, fontFamily : 'TheJamsil2Light', display : 'flex', flexDirection : 'column' }}>
              <span style={{fontFamily : "TheJamsil5Bold", display : "block" }}>ASC</span>
              <span className={ui_styles.text_description_3} style={{ display : "block", marginTop : '-2px' }}>Academic Security Club</span>
            </div>

            <DefaultBtn
              onClick={() => { router.push("/apply") }}
              style={{ marginTop: "30px", fontSize: "15px" }}>
              Apply Us <FaArrowRight />
            </DefaultBtn>
          </div>

          <div
            className={`${ui_styles.floating} ${ui_styles.text_description}`}
            style={{
              bottom: "10px",
              color: "white",
              position: "absolute",
              width: "100dvw",
              textAlign: "center"
            }}>
            <p style={{ "fontSize": "14px" }}>아래로 내려서 더 알아보기</p>

            <LiaAngleDoubleDownSolid style={{ fontSize: "25px" }} />

          </div>
        </div>

        <div
          className={`${styles.wrap}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
          <div
            className={`${styles.content_center} ${styles.introduction}`}>

            <FadeFromLeft className={styles.intro_left} style={{}}>
              <p className={ui_styles.text_title} style={{ fontWeight: 600, wordBreak: "keep-all" }}>
                숭실대학교 정보보안 소모임 ASC
              </p>
              <p className={ui_styles.text_description} style={{ wordBreak: "keep-all" }}>
                실전 중심의 보안 역량을 함께 키우는 공간입니다. 지금 ASC에서 새로운 가능성을 만나보세요.
              </p>
            </FadeFromLeft>

            <FadeFromRight className={styles.intro_right} style={{ }}>
              <p className={ui_styles.text_title} style={{ fontWeight: 600 }}>
                WHO WE ARE?
              </p>
              <p className={ui_styles.text_description} style={{ wordBreak: "keep-all" }}>
                정보보안 분야에 열정을 가진 학생들이 모여 함께 배우고 성장하는 동아리입니다.
                CTF, 모의해킹, 리버싱 등 다양한 실전 경험을 통해 보안 전문성을 꾸준히 쌓아갑니다.
              </p>
            </FadeFromRight>


          </div>

        </div>


        <hr className={ui_styles.headline}></hr>


        <div className={`${styles.wrap}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
          <div className={`${styles.content_default} ${styles.award_wrap}`} style={{ textAlign: "left" }}>

            <FadeFromLeft className={""} style={{ flexGrow: 1, textAlign: "center" }}>
              <p className={ui_styles.text_title} style={{ fontWeight: 600, color: "var(--main-color)", marginBottom: "5px" }}>ASC의 업적</p>
              <p className={ui_styles.text_description}>ASC 구성원은 다양한 대회와 프로젝트에서 의미 있는 성과를 만들어가고 있습니다.</p>
            </FadeFromLeft>
            <FadeFromLeft className={""} style={{}}>
              <div className={ui_styles.awards} style={{ marginTop: "60px" }}>

                {
                  awardsToShow.map((award: any, i: number) => {

                    if (award.image) {
                      return (<DefaultAward
                        contestName={award.contestName}
                        awardName={award.awardName}
                        winnerName={award.winnerName}
                        date={award.date}
                        image={award.image}
                        key={i}
                      />)
                    } else {
                      return (<DefaultAward
                        contestName={award.contestName}
                        awardName={award.awardName}
                        winnerName={award.winnerName}
                        date={award.date}
                        key={i}
                      />)
                    }

                  })
                }

              </div>
              {awardList.awards && awardList.awards.length > 5 && !showAllAwards && (
                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                  <DefaultBtn onClick={() => setShowAllAwards(true)} style={{ width : "100%", marginTop : "30px", padding : "17px 20px" }}>
                    더보기
                  </DefaultBtn>
                </div>
              )}
            </FadeFromLeft>

          </div>
        </div>

        {/* <hr className={ui_styles.headline}></hr> */}


        <div className={`${styles.wrap}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            backgroundColor: "#0e0f10"
          }}>


          { curriculumList && Object.keys(curriculumList).length > 0 ?
            <div className={`${styles.content_default}`} style={{ textAlign: "left", width: "100%", maxWidth: "1350px" }}>

              <FadeFromLeft className={""} style={{}}>
                {/* <p className={ui_styles.text_description} style={{ fontWeight: 500, color: "rgba(0,0,0,0.5)" }}>Q&A</p> */}
                <p className={ui_styles.text_title} style={{ fontWeight: 600, color: "rgba(255,255,255,0.8)", }}>ASC 커리큘럼</p>
                <p className={ui_styles.text_description} style={{ color: "rgba(255,255,255,0.5)" }}>어떤 내용을 배우게 될지 미리 확인해보세요.</p>
              </FadeFromLeft>




              <FadeFromLeft className={""} style={{}}>
                <div className={ui_styles.curriculum_wrap}>

                  <div className={ui_styles.curriculums}>

                    {
                      Object.keys(curriculumList).map((name: string, i: number) => {
                        return <DefaultCurriculum
                          key={i}
                          curriculumName={name}
                          isActive={activeCurriculum === name}
                          onClick={() => setActiveCurriculum(name)}
                          ShowCase={showCaseRef.current}
                        >
                          <div className={ui_styles.curriculum_info}>
                            <p className={ui_styles.text_description_2} style={{ color: "rgba(255,255,255,0.5)", display: "flex", gap: "5px", alignItems: "center", marginBottom: "10px" }} >
                              <FaMemory /> {curriculumList[name].tech}
                            </p>
                            <p className={ui_styles.text_title} style={{ fontWeight: 600, color: "rgba(255,255,255,0.8)", marginBottom: "10px" }}>{curriculumList[name].name}</p>
                            <p className={ui_styles.text_description_2} style={{ color: "rgba(255,255,255,0.5)", fontWeight: 300 }}>
                              {curriculumList[name].description}
                            </p>

                            <DefaultBtn style={{ marginTop: "20px" }} onClick={() => { router.push(curriculumList[name].link) }}>Go Learning <FaArrowRight /> </DefaultBtn>

                          </div>

                          <div className={`${ui_styles.curriculum_info} ${ui_styles.image}`}>
                            <Image src={withBasePath(curriculumList[name].image)} width={100} height={100} alt=""></Image>
                          </div>
                        </DefaultCurriculum>
                      })
                    }


                  </div>

                  <div className={ui_styles.curriculum_info_wrap} ref={showCaseRef} />
                </div>
              </FadeFromLeft>



            </div>

            : <></>}

        </div>


        <div className={`${styles.wrap}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            backgroundColor: "#0e0f10",
          }}>


          <div className={`${styles.content_default}`} style={{ textAlign: "left", width: "100%", maxWidth: "1350px", paddingTop: Object.keys(curriculumList).length > 0 ? "30px" : "120px" }}>

            <div className={ui_styles.team_activity_wrap}>

              <FadeFromLeft className={""} style={{}}>
                <p className={ui_styles.text_title_2} style={{ fontWeight: 600, color: "rgba(255,255,255,0.8)", width: "100%" }}>ASC 소모임 활동</p>
                <p className={ui_styles.text_description_2} style={{ color: "rgba(255,255,255,0.5)" }}>ASC가 지금까지 쌓아온 활동과 성과입니다.</p>
              </FadeFromLeft>

              <FadeFromRight className={""} style={{}}>
                {
                  activityList.activities && activityList.activities.map((activity: any, i: number) => {
                    return <DefaultTeamActivity key={i} name={activity.name} description={activity.description} defaultOpen={i === 0} />
                  })
                }
              </FadeFromRight>




            </div>



          </div>

        </div>

        <div className={`${styles.wrap}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            backgroundColor: "#0e0f10",
          }}>

          <div className={`${styles.content_default}`} style={{ textAlign: "left", width: "100%", maxWidth: "1350px", paddingTop: "40px" }}>
            <FadeFromLeft className={""} style={{}}>
              <p className={ui_styles.text_title_2} style={{ fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>ASC 프로젝트</p>
              <p className={ui_styles.text_description_2} style={{ color: "rgba(255,255,255,0.55)", marginTop: "8px" }}>
                연도별 진행한 프로젝트입니다.
              </p>
            </FadeFromLeft>

            <FadeFromRight className={""} style={{}}>
              {projectTimeline.length > 0 ? (
                <>
                  <div className={ui_styles.project_year_tabs}>
                    {projectTimeline.map((yearSection: any, i: number) => {
                      const isActive = selectedProjectYearSection?.year === yearSection.year;
                      return (
                        <button
                          key={`${yearSection.year}-${i}`}
                          className={`${ui_styles.project_year_tab} ${isActive ? ui_styles.project_year_tab_active : ""}`}
                          onClick={() => toggleProjectYear(yearSection.year)}
                        >
                          {yearSection.year}년
                        </button>
                      );
                    })}
                  </div>

                  <div className={ui_styles.project_timeline}>
                    <div className={ui_styles.project_year_panel}>
                      {selectedProjectList.length > 0 ? (
                        <div key={selectedProjectYearSection.year} className={`${ui_styles.project_year_track} ${ui_styles.project_year_track_switch}`}>
                          {selectedProjectList.map((project: any, projectIndex: number) => (
                            <article key={`${selectedProjectYearSection.year}-${project.title}-${projectIndex}`} className={ui_styles.project_milestone}>
                              <span className={ui_styles.project_milestone_dot}></span>
                              <div className={ui_styles.project_milestone_card}>
                                <div className={ui_styles.project_milestone_thumbnail_wrap}>
                                  <Image
                                    className={ui_styles.project_milestone_thumbnail}
                                    src={withBasePath(typeof project.image === "string" && project.image.trim() !== "" ? project.image : "/award_image/placeholder-64.png")}
                                    width={320}
                                    height={190}
                                    alt={project.title}
                                  />
                                </div>

                                <div className={ui_styles.project_milestone_content}>
                                  <p className={ui_styles.project_milestone_title}>{project.title}</p>
                                  {project.members && (
                                    <p className={ui_styles.project_milestone_members}>인원: {project.members}</p>
                                  )}
                                  <p className={ui_styles.project_milestone_description}>{project.description}</p>

                                  {project.tags && project.tags.length > 0 && (
                                    <div className={ui_styles.project_milestone_tags}>
                                      {project.tags.map((tag: string, tagIndex: number) => (
                                        <span key={`${project.title}-${tag}-${tagIndex}`} className={ui_styles.project_milestone_tag}>{tag}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className={ui_styles.project_timeline_empty_state}>
                          <p className={ui_styles.project_timeline_empty_title}>
                            {selectedProjectYearSection.emptyTitle ?? "등록된 프로젝트가 아직 없습니다."}
                          </p>
                          {selectedProjectYearSection.emptyDescription && (
                            <p className={ui_styles.project_timeline_empty_description}>
                              {selectedProjectYearSection.emptyDescription}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className={ui_styles.project_timeline_empty}>등록된 프로젝트가 아직 없습니다.</p>
              )}
            </FadeFromRight>
          </div>
        </div>

        <div
          className={styles.wrap}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minHeight: "420px",
          }}
        >
          <div className={`${styles.content_default} ${styles.award_wrap}`} style={{ width: "100%", maxWidth: "1200px", textAlign: "left", paddingTop: "90px", paddingBottom: "120px" }}>
            <FadeFromLeft className={""} style={{}}>
              <div className={ui_styles.home_cta_box}>
                <p className={ui_styles.home_cta_title}>ASC에서 같이 성장해요.</p>
                <p className={ui_styles.home_cta_description}>
                  프로젝트, CTF, 세미나까지. 함께하고 싶다면 지금 바로 지원하세요
                </p>

                <div className={ui_styles.home_cta_action}>
                  <DefaultBtn onClick={() => { router.push("/apply"); }} style={{ padding: "14px 24px" }}>
                    지원하기 <FaArrowRight />
                  </DefaultBtn>
                </div>
              </div>
            </FadeFromLeft>
          </div>
        </div>

      </main>
    </div>
  );
}
